import { randomUUID } from "crypto";
import { config } from "../config/env";
import { withTransaction } from "../db/pool";
import {
  getOrderWithItems,
  insertOrder,
  setDisplayNumber,
  upsertOrderItem,
} from "./orders.repository";
import { broadcastOrderCreated } from "../sockets/io";
import type { OrderWithItems } from "./orders.types";

export interface IncomingPrinterTicketItem {
  name: string;
  quantity: string;
  modifiers: string[];
  note: string | null;
}

export interface IncomingPrinterTicket {
  displayNumber: string | null;
  items: IncomingPrinterTicketItem[];
}

/**
 * Ingests a ticket parsed from Square's local print traffic by printer-sim/. One-shot insert,
 * not an incremental re-sync (there's no Square order id to key future updates off of), so
 * unlike orderSync.service.ts there's no upsert-by-square-order-id or deleteOrderItemsNotIn.
 */
export async function ingestPrinterTicket(ticket: IncomingPrinterTicket): Promise<OrderWithItems> {
  const squareOrderId = `printer:${randomUUID()}`;

  const orderId = await withTransaction(async (client) => {
    const order = await insertOrder(
      {
        squareOrderId,
        squareLocationId: config.SQUARE_LOCATION_ID,
        squareVersion: 0,
        displayNumber: ticket.displayNumber,
        fulfillmentUid: null,
        squareFulfillmentState: null,
        pickupAt: null,
        note: null,
        source: "printer",
      },
      client
    );

    if (!ticket.displayNumber) {
      // The printed ticket had no recognizable order/ticket number for ticket.mapper.ts to
      // extract — fall back to a locally-assigned number, visually distinct from Square's.
      await setDisplayNumber(order.id, `P-${order.id}`, client);
    }

    let index = 0;
    for (const item of ticket.items) {
      index += 1;
      await upsertOrderItem(
        order.id,
        {
          squareLineItemUid: `printer-item-${index}`,
          catalogObjectId: null,
          name: item.name,
          variationName: null,
          quantity: item.quantity,
          modifiers: item.modifiers.map((name) => ({ name, catalogObjectId: null })),
          note: item.note,
        },
        client
      );
    }

    return order.id;
  });

  const orderWithItems = await getOrderWithItems(orderId);
  if (!orderWithItems) {
    throw new Error(`Failed to load printer-sourced order ${orderId} after insert`);
  }

  broadcastOrderCreated(orderWithItems);
  return orderWithItems;
}
