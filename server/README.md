# KDS Backend

Express + TypeScript backend for a restaurant Kitchen Display System, integrating with Square's Orders API.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `SQUARE_ACCESS_TOKEN` / `SQUARE_ENVIRONMENT` / `SQUARE_LOCATION_ID` — from your Square Developer app (use Sandbox first)
   - `SQUARE_WEBHOOK_SIGNATURE_KEY` / `SQUARE_WEBHOOK_NOTIFICATION_URL` — created when you register a webhook subscription in the Square dashboard (point it at `<public-url>/webhooks/square`, e.g. an ngrok tunnel in dev)
   - `DATABASE_URL` — a running PostgreSQL instance
3. Create the schema: `npm run db:init` (runs `db/schema.sql` via `psql`)
4. `npm run dev`

## Square webhook subscription

In the Square Developer Dashboard, create a webhook subscription pointed at `SQUARE_WEBHOOK_NOTIFICATION_URL` for these events:
- `order.created`
- `order.updated`
- `order.fulfillment.updated`

## REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orders/active` | Orders currently in progress, for the KDS screen |
| GET | `/api/orders/:id` | Single order detail |
| PATCH | `/api/orders/:id/items/:itemId/complete` | Body `{ completed: boolean }` — mark an item done/not done |
| GET | `/api/display/summary` | In-progress + "now serving" lists, for the customer-facing display |
| POST | `/api/test/orders` | Creates a real order in Square for local testing (exercises the full webhook → sync path). Disabled when `NODE_ENV=production` |

## Realtime (Socket.IO)

Connect and emit `join` with `{ role: "kds" }` or `{ role: "display" }`. Server emits `order:created`, `order:updated`, `item:updated` (kds only), and `order:completed`.
