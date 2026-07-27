import { squareClient } from "../square/client";
import { notificationService } from "../notifications/consoleNotificationService";
import {
  getItemsForOrder,
  getOrderById,
  getOrderWithItems,
  markOrderCompleted,
  markOrderInProgress,
  recordSquareSync,
  resetOrderItemsCompletion,
  setItemCompleted,
} from "./orders.repository";
import { broadcastItemUpdated, broadcastOrderCompleted, broadcastOrderUpdated } from "../sockets/io";
import type { OrderRow, OrderWithItems } from "./orders.types";

export async function setItemCompletion(itemId: number, completed: boolean): Promise<void> {
  const item = await setItemCompleted(itemId, completed);
  if (!item) {
    throw new Error(`Order item ${itemId} not found`);
  }

  broadcastItemUpdated({
    orderId: item.order_id,
    itemId: item.id,
    completed: item.completed,
    completedAt: item.completed_at,
  });

  const order = await getOrderById(item.order_id);
  if (!order) return;

  const items = await getItemsForOrder(item.order_id);
  const allComplete = items.length > 0 && items.every((i) => i.completed);

  if (allComplete && order.state !== "COMPLETED") {
    await completeOrder(order);
  } else if (!completed && order.state === "COMPLETED") {
    console.warn(
      `[orderCompletion] Order ${order.square_order_id} was un-completed locally after being marked COMPLETED. ` +
        `Square's fulfillment state was not reverted (Square disallows updating COMPLETED orders) — state has diverged.`
    );
    await markOrderInProgress(order.id);
  }
}

export async function recallOrder(orderId: number): Promise<OrderWithItems | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;

  if (order.state !== "COMPLETED") {
    const err = new Error(`Order ${orderId} is not completed and cannot be recalled`) as Error & {
      statusCode?: number;
    };
    err.statusCode = 409;
    throw err;
  }

  await resetOrderItemsCompletion(order.id);
  await markOrderInProgress(order.id);

  console.warn(
    `[orderCompletion] Order ${order.square_order_id} was recalled locally after being marked COMPLETED. ` +
      `Square's fulfillment state was not reverted (Square disallows updating COMPLETED orders) — state has diverged.`
  );

  const updated = await getOrderWithItems(order.id);
  if (!updated) return null;

  broadcastOrderUpdated(updated);
  return updated;
}

async function completeOrder(order: OrderRow): Promise<void> {
  const updated = await markOrderCompleted(order.id);

  await pushCompletionToSquare(updated);

  await notificationService.notifyOrderReady({
    squareOrderId: updated.square_order_id,
    displayNumber: updated.display_number,
  });

  broadcastOrderCompleted({
    orderId: updated.id,
    displayNumber: updated.display_number,
    readyAt: updated.ready_at,
  });

  const withItems = await getOrderWithItems(updated.id);
  if (withItems) broadcastOrderUpdated(withItems);
}

async function pushCompletionToSquare(order: OrderRow): Promise<void> {
  try {
    const response = await squareClient.orders.get({ orderId: order.square_order_id });
    const latest = response.order;

    if (!latest || latest.version === undefined) {
      console.error(
        `[orderCompletion] Could not fetch latest version for Square order ${order.square_order_id}; skipping fulfillment push`
      );
      return;
    }

    if (latest.state === "COMPLETED" || latest.state === "CANCELED") {
      console.warn(
        `[orderCompletion] Square order ${order.square_order_id} is already ${latest.state}; skipping fulfillment update`
      );
      return;
    }

    const fulfillmentUid = order.fulfillment_uid ?? latest.fulfillments?.[0]?.uid;
    if (!fulfillmentUid) {
      console.warn(
        `[orderCompletion] Square order ${order.square_order_id} has no fulfillment to mark completed`
      );
      return;
    }

    await squareClient.orders.update({
      orderId: order.square_order_id,
      order: {
        locationId: order.square_location_id,
        version: latest.version,
        fulfillments: [{ uid: fulfillmentUid, state: "COMPLETED" }],
      },
    });

    await recordSquareSync(order.id, "COMPLETED");
  } catch (err) {
    console.error(
      `[orderCompletion] Failed to push completion to Square for order ${order.square_order_id}:`,
      err
    );
  }
}
