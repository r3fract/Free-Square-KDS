import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import type { OrderItemRow, OrderRow, OrderModifier, OrderSource, OrderWithItems } from "./orders.types";

type Queryable = Pool | PoolClient;

export async function findOrderBySquareId(
  squareOrderId: string,
  db: Queryable = pool
): Promise<OrderRow | null> {
  const result = await db.query<OrderRow>(
    "SELECT * FROM orders WHERE square_order_id = $1",
    [squareOrderId]
  );
  return result.rows[0] ?? null;
}

export async function insertOrder(
  params: {
    squareOrderId: string;
    squareLocationId: string;
    squareVersion: number;
    displayNumber: string | null;
    fulfillmentUid: string | null;
    squareFulfillmentState: string | null;
    pickupAt: string | null;
    note: string | null;
    source?: OrderSource;
  },
  db: Queryable = pool
): Promise<OrderRow> {
  const result = await db.query<OrderRow>(
    `INSERT INTO orders (
       square_order_id, square_location_id, square_version,
       display_number, fulfillment_uid, square_fulfillment_state, pickup_at, note, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.squareOrderId,
      params.squareLocationId,
      params.squareVersion,
      params.displayNumber,
      params.fulfillmentUid,
      params.squareFulfillmentState,
      params.pickupAt,
      params.note,
      params.source ?? "square",
    ]
  );
  return result.rows[0];
}

export async function updateOrderFromSquare(
  orderId: number,
  params: {
    squareVersion: number;
    displayNumber: string | null;
    fulfillmentUid: string | null;
    squareFulfillmentState: string | null;
    pickupAt: string | null;
    note: string | null;
    squareState: string;
  },
  db: Queryable = pool
): Promise<OrderRow> {
  // Local state is driven by the kitchen workflow (all-items-done), not by Square's
  // order state, except CANCELED which always wins.
  const result = await db.query<OrderRow>(
    `UPDATE orders
     SET square_version = $2,
         display_number = $3,
         fulfillment_uid = $4,
         square_fulfillment_state = $5,
         pickup_at = $6,
         note = $7,
         state = CASE WHEN $8 = 'CANCELED' THEN 'CANCELED' ELSE state END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      orderId,
      params.squareVersion,
      params.displayNumber,
      params.fulfillmentUid,
      params.squareFulfillmentState,
      params.pickupAt,
      params.note,
      params.squareState,
    ]
  );
  return result.rows[0];
}

export async function upsertOrderItem(
  orderId: number,
  item: {
    squareLineItemUid: string;
    catalogObjectId: string | null;
    name: string;
    variationName: string | null;
    quantity: string;
    modifiers: OrderModifier[];
    note: string | null;
  },
  db: Queryable = pool
): Promise<OrderItemRow> {
  const result = await db.query<OrderItemRow>(
    `INSERT INTO order_items (
       order_id, square_line_item_uid, catalog_object_id, name,
       variation_name, quantity, modifiers, note
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id, square_line_item_uid) DO UPDATE SET
       catalog_object_id = EXCLUDED.catalog_object_id,
       name = EXCLUDED.name,
       variation_name = EXCLUDED.variation_name,
       quantity = EXCLUDED.quantity,
       modifiers = EXCLUDED.modifiers,
       note = EXCLUDED.note,
       updated_at = now()
     RETURNING *`,
    [
      orderId,
      item.squareLineItemUid,
      item.catalogObjectId,
      item.name,
      item.variationName,
      item.quantity,
      JSON.stringify(item.modifiers),
      item.note,
    ]
  );
  return result.rows[0];
}

export async function deleteOrderItemsNotIn(
  orderId: number,
  keepUids: string[],
  db: Queryable = pool
): Promise<void> {
  await db.query(
    `DELETE FROM order_items
     WHERE order_id = $1 AND NOT (square_line_item_uid = ANY($2::text[]))`,
    [orderId, keepUids]
  );
}

export async function getItemsForOrder(
  orderId: number,
  db: Queryable = pool
): Promise<OrderItemRow[]> {
  const result = await db.query<OrderItemRow>(
    "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC",
    [orderId]
  );
  return result.rows;
}

export async function getOrderById(
  orderId: number,
  db: Queryable = pool
): Promise<OrderRow | null> {
  const result = await db.query<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] ?? null;
}

export async function getOrderWithItems(orderId: number): Promise<OrderWithItems | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;
  const items = await getItemsForOrder(orderId);
  return { ...order, items };
}

export async function getActiveOrders(): Promise<OrderWithItems[]> {
  const ordersResult = await pool.query<OrderRow>(
    "SELECT * FROM orders WHERE state = 'IN_PROGRESS' ORDER BY created_at ASC"
  );
  return attachItems(ordersResult.rows);
}

export async function getCompletedOrders(limit: number): Promise<OrderWithItems[]> {
  const ordersResult = await pool.query<OrderRow>(
    "SELECT * FROM orders WHERE state = 'COMPLETED' ORDER BY ready_at DESC LIMIT $1",
    [limit]
  );
  return attachItems(ordersResult.rows);
}

export async function getNowServing(withinMinutes: number): Promise<OrderWithItems[]> {
  const ordersResult = await pool.query<OrderRow>(
    `SELECT * FROM orders
     WHERE state = 'COMPLETED' AND ready_at > now() - ($1 || ' minutes')::interval
     ORDER BY ready_at DESC`,
    [withinMinutes]
  );
  return attachItems(ordersResult.rows);
}

async function attachItems(orders: OrderRow[]): Promise<OrderWithItems[]> {
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const itemsResult = await pool.query<OrderItemRow>(
    "SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id ASC",
    [ids]
  );
  const itemsByOrderId = new Map<number, OrderItemRow[]>();
  for (const item of itemsResult.rows) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }
  return orders.map((order) => ({ ...order, items: itemsByOrderId.get(order.id) ?? [] }));
}

export async function setItemCompleted(
  itemId: number,
  completed: boolean
): Promise<OrderItemRow | null> {
  const result = await pool.query<OrderItemRow>(
    `UPDATE order_items
     SET completed = $2, completed_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [itemId, completed]
  );
  return result.rows[0] ?? null;
}

export async function resetOrderItemsCompletion(orderId: number): Promise<void> {
  await pool.query(
    `UPDATE order_items
     SET completed = false, completed_at = NULL, updated_at = now()
     WHERE order_id = $1`,
    [orderId]
  );
}

export async function markOrderCompleted(orderId: number): Promise<OrderRow> {
  const result = await pool.query<OrderRow>(
    `UPDATE orders SET state = 'COMPLETED', ready_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [orderId]
  );
  return result.rows[0];
}

export async function markOrderInProgress(orderId: number): Promise<OrderRow> {
  const result = await pool.query<OrderRow>(
    `UPDATE orders SET state = 'IN_PROGRESS', ready_at = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [orderId]
  );
  return result.rows[0];
}

export async function setDisplayNumber(
  orderId: number,
  displayNumber: string,
  db: Queryable = pool
): Promise<OrderRow> {
  const result = await db.query<OrderRow>(
    `UPDATE orders SET display_number = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [orderId, displayNumber]
  );
  return result.rows[0];
}

export async function recordSquareSync(
  orderId: number,
  squareFulfillmentState: string
): Promise<void> {
  await pool.query(
    `UPDATE orders
     SET square_fulfillment_state = $2, square_synced_at = now(), updated_at = now()
     WHERE id = $1`,
    [orderId, squareFulfillmentState]
  );
}
