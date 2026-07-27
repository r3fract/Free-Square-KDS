CREATE TABLE IF NOT EXISTS orders (
  id                       SERIAL PRIMARY KEY,
  square_order_id          TEXT NOT NULL UNIQUE,
  square_location_id       TEXT NOT NULL,
  square_version           INTEGER NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                             CHECK (state IN ('IN_PROGRESS', 'COMPLETED', 'CANCELED')),
  display_number           TEXT,
  fulfillment_uid          TEXT,
  square_fulfillment_state TEXT,
  pickup_at                TIMESTAMPTZ,
  note                     TEXT,
  ready_at                 TIMESTAMPTZ,
  square_synced_at         TIMESTAMPTZ,
  -- 'printer' rows come from printer-sim/ (offline ticket capture), not a real Square order:
  -- square_order_id is a synthetic "printer:<uuid>" sentinel, square_location_id mirrors
  -- SQUARE_LOCATION_ID, and square_version is always 0 — see printerTickets.routes.ts.
  source                   TEXT NOT NULL DEFAULT 'square'
                             CHECK (source IN ('square', 'printer')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id                    SERIAL PRIMARY KEY,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  square_line_item_uid  TEXT NOT NULL,
  catalog_object_id     TEXT,
  name                  TEXT NOT NULL,
  variation_name        TEXT,
  quantity              TEXT NOT NULL DEFAULT '1',
  modifiers             JSONB NOT NULL DEFAULT '[]'::jsonb,
  note                  TEXT,
  completed             BOOLEAN NOT NULL DEFAULT false,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, square_line_item_uid)
);

CREATE INDEX IF NOT EXISTS idx_orders_state ON orders (state);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);

-- Hand-applied ALTER for databases initialized before the `source` column existed
-- (no-op on a fresh CREATE TABLE above, since the column is already present there).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'square'
  CHECK (source IN ('square', 'printer'));
