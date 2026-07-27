export type OrderState = "IN_PROGRESS" | "COMPLETED" | "CANCELED";
export type OrderSource = "square" | "printer";

export interface OrderModifier {
  name: string;
  catalogObjectId?: string | null;
}

export interface OrderRow {
  id: number;
  square_order_id: string;
  square_location_id: string;
  square_version: number;
  state: OrderState;
  display_number: string | null;
  fulfillment_uid: string | null;
  square_fulfillment_state: string | null;
  pickup_at: string | null;
  note: string | null;
  ready_at: string | null;
  square_synced_at: string | null;
  source: OrderSource;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  square_line_item_uid: string;
  catalog_object_id: string | null;
  name: string;
  variation_name: string | null;
  quantity: string;
  modifiers: OrderModifier[];
  note: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
}
