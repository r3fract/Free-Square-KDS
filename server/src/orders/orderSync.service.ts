import type { Order, OrderLineItem } from "square";
import { squareClient } from "../square/client";
import { withTransaction } from "../db/pool";
import {
  deleteOrderItemsNotIn,
  findOrderBySquareId,
  insertOrder,
  updateOrderFromSquare,
  upsertOrderItem,
} from "./orders.repository";
import { getOrderWithItems } from "./orders.repository";
import { broadcastOrderCreated, broadcastOrderUpdated } from "../sockets/io";
import type { OrderModifier } from "./orders.types";

function toModifiers(lineItem: OrderLineItem): OrderModifier[] {
  return (lineItem.modifiers ?? []).map((m) => ({
    name: m.name ?? "Modifier",
    catalogObjectId: m.catalogObjectId ?? null,
  }));
}

export async function syncFromSquareOrderId(squareOrderId: string): Promise<void> {
  const response = await squareClient.orders.get({ orderId: squareOrderId });
  const order: Order | undefined = response.order;

  if (!order || !order.id) {
    console.warn(`[orderSync] Square order ${squareOrderId} not found in response, skipping`);
    return;
  }

  const incomingVersion = Number(order.version ?? 0);
  const existing = await findOrderBySquareId(order.id);

  if (existing && incomingVersion <= existing.square_version) {
    console.log(
      `[orderSync] Skipping stale sync for order ${order.id} (incoming v${incomingVersion} <= stored v${existing.square_version})`
    );
    return;
  }

  const fulfillment = order.fulfillments?.[0];
  const lineItems = order.lineItems ?? [];
  const isNewOrder = !existing;
  const displayNumber =
    fulfillment?.pickupDetails?.recipient?.displayName ?? order.ticketName ?? order.id;
  const pickupAt = fulfillment?.pickupDetails?.pickupAt ?? null;
  const note = fulfillment?.pickupDetails?.note ?? order.tenders?.[0]?.note ?? null;

  const localOrderId = await withTransaction(async (client) => {
    const localOrder = existing
      ? await updateOrderFromSquare(
          existing.id,
          {
            squareVersion: incomingVersion,
            displayNumber,
            fulfillmentUid: fulfillment?.uid ?? null,
            squareFulfillmentState: fulfillment?.state ?? null,
            pickupAt,
            note,
            squareState: order.state ?? "OPEN",
          },
          client
        )
      : await insertOrder(
          {
            squareOrderId: order.id!,
            squareLocationId: order.locationId ?? "",
            squareVersion: incomingVersion,
            displayNumber,
            fulfillmentUid: fulfillment?.uid ?? null,
            squareFulfillmentState: fulfillment?.state ?? null,
            pickupAt,
            note,
          },
          client
        );

    const seenUids: string[] = [];
    for (const lineItem of lineItems) {
      if (!lineItem.uid) continue;
      seenUids.push(lineItem.uid);
      await upsertOrderItem(
        localOrder.id,
        {
          squareLineItemUid: lineItem.uid,
          catalogObjectId: lineItem.catalogObjectId ?? null,
          name: lineItem.name ?? "Item",
          variationName: lineItem.variationName ?? null,
          quantity: lineItem.quantity ?? "1",
          modifiers: toModifiers(lineItem),
          note: lineItem.note ?? null,
        },
        client
      );
    }
    await deleteOrderItemsNotIn(localOrder.id, seenUids, client);

    return localOrder.id;
  });

  const orderWithItems = await getOrderWithItems(localOrderId);
  if (!orderWithItems) return;

  if (isNewOrder) {
    broadcastOrderCreated(orderWithItems);
  } else {
    broadcastOrderUpdated(orderWithItems);
  }
}
