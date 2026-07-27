# AGENTS.md — KDS Backend

This file documents the `server/` project in full for any human or AI agent picking up work here. It covers what the system does, why it's built this way, the exact file layout, data model, API/event contracts, the Square API integration details that were verified against the real SDK, and known gaps.

## What this is

Backend for a restaurant Kitchen Display System (KDS). It syncs orders from Square, lets kitchen staff mark individual line items complete, auto-completes the order (and pushes that back to Square) once every item is done, and drives two realtime UIs over Socket.IO:
- a **KDS screen** (kitchen staff view — active orders + items to check off)
- a **customer-facing display** (orders in progress / "now serving")

This `server/` folder is one half of a monorepo — `../frontend` (a separate git repo) holds the UI(s). `server/` has no git repo of its own yet.

## Why it's built this way

Square's Orders API has no concept of "is this specific line item done cooking." An `Order` only has a top-level `state` (OPEN/COMPLETED/CANCELED/DRAFT) and, separately, per-fulfillment `state` (PROPOSED/RESERVED/PREPARED/COMPLETED/CANCELED/FAILED). So per-item completion tracking has to live in our own Postgres database, keyed off Square's `order.id` and each line item's `uid`. Only the order-level "all items done" signal gets pushed back up to Square (as a fulfillment state update). This is the central design fact that shapes almost everything below.

## Decisions locked in (do not re-litigate without a reason)

- **Language**: TypeScript, compiled with `tsc`, run in dev via `tsx watch`.
- **Database**: PostgreSQL via plain `pg` (no ORM, no migration framework — hand-maintained `db/schema.sql`).
- **Realtime**: Socket.IO, using **rooms** (`kds`, `display`), not namespaces. Clients emit `join` once; all mutations happen over REST, not over sockets — one source of truth for writes/validation.
- **Order source of truth**: Square, via **webhooks** (`order.created`, `order.updated`, `order.fulfillment.updated`). The webhook payload never contains the full order — every event triggers a refetch via `client.orders.get` and a local upsert.
- **Fulfillment modeling**: "all items complete" → push Square fulfillment `state` straight to `COMPLETED`. There is no intermediate "picked up" step tracked in this system (see Out of scope).
- **Notifications**: `NotificationService` is a stub interface (console.log impl). No real SMS/push provider is wired up.
- **Auth**: none. This assumes a trusted local kitchen network. Do not add auth speculatively — if it's needed, that's a real scoped feature, not a drive-by addition.
- **display_number**: derived from Square at every sync, in priority order: `fulfillments[0].pickupDetails.recipient.displayName` (the pickup name — what `POST /api/test/orders`'s `customerName` and typical POS "guest name" entry populate), then `order.ticketName` (rarely set in practice), then Square's own `order.id` as a last resort. Recomputed on every webhook-driven sync, not just at first insert.

## Directory layout

```
server/
├── package.json / tsconfig.json / .env.example / .gitignore
├── db/
│   └── schema.sql              # hand-maintained, run manually via `npm run db:init`
├── src/
│   ├── index.ts                 # entrypoint: builds app + http server + socket.io, listens
│   ├── app.ts                   # express app assembly — middleware + route mounting order matters here
│   ├── config/
│   │   └── env.ts               # zod-validated env vars → typed `config` singleton; process.exit(1) on invalid env
│   ├── db/
│   │   └── pool.ts              # pg Pool singleton, query() helper, withTransaction() helper
│   ├── square/
│   │   └── client.ts            # SquareClient singleton (token + environment from config)
│   ├── sockets/
│   │   └── io.ts                # Socket.IO server setup, room join handling, typed broadcast* helpers
│   ├── notifications/
│   │   ├── notificationService.ts        # NotificationService interface
│   │   └── consoleNotificationService.ts # stub impl + exported singleton instance
│   ├── orders/
│   │   ├── orders.types.ts          # OrderRow / OrderItemRow / OrderWithItems / OrderModifier
│   │   ├── orders.repository.ts     # all raw SQL against orders/order_items
│   │   ├── orderSync.service.ts     # Square Order → local upsert (the webhook-driven sync path)
│   │   ├── orderCompletion.service.ts # item complete/uncomplete, all-complete detection, Square push
│   │   └── orders.routes.ts         # REST: KDS + display + test-order endpoints
│   ├── webhooks/
│   │   ├── square.webhook.routes.ts  # POST /webhooks/square — raw-body scoped, signature-verified
│   │   └── square.webhook.verify.ts  # thin wrapper around WebhooksHelper.verifySignature
│   └── middleware/
│       ├── asyncHandler.ts       # wraps async route handlers, forwards rejections to next(err)
│       ├── errorHandler.ts       # 4-arg Express error handler, registered last in app.ts
│       └── requestLogger.ts      # one console.log line per request (method, path, status, ms)
└── README.md                    # quickstart-oriented setup instructions (shorter than this file)
```

## Environment variables (`src/config/env.ts`)

All required unless noted; validated once at startup with zod, process exits with a clear error if invalid.

| Var | Notes |
|---|---|
| `SQUARE_ACCESS_TOKEN` | from a Square Developer app |
| `SQUARE_ENVIRONMENT` | `sandbox` \| `production`, default `sandbox` |
| `SQUARE_LOCATION_ID` | single location for v1 — no multi-location support |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | from the webhook subscription in the Square dashboard |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | the exact public URL registered for the webhook subscription — must match what Square has on file, used in signature verification |
| `DATABASE_URL` | Postgres connection string |
| `PORT` | default `3000` |

## Database schema (`db/schema.sql`)

Two tables, no ORM, applied via `npm run db:init` (`psql "$DATABASE_URL" -f db/schema.sql`, idempotent `CREATE ... IF NOT EXISTS`).

```sql
orders
  id                       SERIAL PK
  square_order_id          TEXT UNIQUE       -- join key to Square
  square_location_id       TEXT
  square_version           INTEGER           -- last-seen Square order version; stale-webhook guard
  state                    TEXT              -- IN_PROGRESS | COMPLETED | CANCELED (local, kitchen-driven)
  display_number           TEXT              -- Square order.ticketName, else Square order.id; refreshed every sync
  fulfillment_uid          TEXT              -- Square fulfillment uid we PATCH on completion
  square_fulfillment_state TEXT              -- last-known Square fulfillment state (mirrored, not authoritative)
  pickup_at                TIMESTAMPTZ        -- Square fulfillment.pickupDetails.pickupAt, mirrored every sync
  note                     TEXT              -- fulfillment.pickupDetails.note if set, else tenders[0].note (order-level instructions; in practice Sandbox test/payment flows populate the tender note, not the pickup note)
  ready_at                 TIMESTAMPTZ        -- set when order marked COMPLETED locally
  square_synced_at         TIMESTAMPTZ        -- last successful push of fulfillment state to Square
  created_at / updated_at

order_items
  id                    SERIAL PK
  order_id              FK -> orders, ON DELETE CASCADE
  square_line_item_uid  TEXT               -- UNIQUE with order_id
  catalog_object_id     TEXT
  name                  TEXT               -- denormalized from Square at sync time
  variation_name        TEXT
  quantity              TEXT               -- Square models quantity as a string, so do we
  modifiers             JSONB              -- [{ name, catalogObjectId }] — not normalized, nothing joins on it
  note                  TEXT
  completed             BOOLEAN            -- LOCALLY OWNED — never touched by Square sync
  completed_at           TIMESTAMPTZ
  created_at / updated_at
```

Indexes on `orders.state` and `order_items.order_id`.

**Critical invariant**: `orderSync.service.ts` upserts only Square-sourced columns (`name`, `variation_name`, `quantity`, `modifiers`, `note`, `catalog_object_id`) on conflict — it must never reset `completed`/`completed_at`. If Square's order gets re-edited before the kitchen finishes it, item rows whose `square_line_item_uid` disappeared from the incoming order are deleted (see `deleteOrderItemsNotIn`).

## Core flows

### 1. Webhook → sync (`square.webhook.routes.ts` + `orderSync.service.ts`)

`POST /webhooks/square`:
1. `express.raw({ type: "application/json" })` is scoped **only** to this route, registered in `app.ts` **before** the global `express.json()` — the raw string is required for signature verification. Getting this ordering wrong (e.g. adding a global body parser above the webhook mount) silently breaks signature verification.
2. `verifySquareSignature(rawBody, req.header("x-square-hmacsha256-signature"))` → `WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl })`.
3. **On invalid signature: respond `403`.** This was a deliberate choice over silently-200'ing (which Square's own example code does, to avoid retry storms): this is a trusted, single-location tool, and a loud failure during setup beats a webhook that "looks fine" to Square but never actually processes anything. Revisit if this ever sits on the open internet without another layer of protection.
4. On valid signature: respond `200` **immediately**, then process asynchronously (no queue — just an async call with `.catch()` logging). `order.created` / `order.updated` / `order.fulfillment.updated` all funnel into the same `syncFromSquareOrderId(event.data.id)` — the payload never carries the full order, so there's no reason to special-case by event type.

`syncFromSquareOrderId(squareOrderId)`:
1. `client.orders.get({ orderId })` → `response.order` (see Square SDK Response Shapes below — this is **not** wrapped in `.result`).
2. If missing, log + return.
3. Stale-webhook guard: if a local row exists and `order.version <= existing.square_version`, skip (webhook deliveries can duplicate or arrive out of order).
4. Everything else happens inside one Postgres transaction (`withTransaction`):
   - Insert (new order → assigns `display_number` from `order_display_seq`) or update (existing order, mirrors `square_version`/`fulfillment_uid`/`square_fulfillment_state`; local `state` only ever gets forced to `CANCELED` from here — otherwise it's left alone, since local state is kitchen-driven).
   - Upsert every line item (`ON CONFLICT (order_id, square_line_item_uid) DO UPDATE`, Square-sourced columns only).
   - Delete any local item rows whose uid is no longer present on the incoming Square order.
5. After the transaction commits, re-fetch the order+items from Postgres and broadcast `order:created` (new order) or `order:updated` (existing) over Socket.IO to both rooms.

### 2. Item completion (`orderCompletion.service.ts`, driven by the PATCH route)

`setItemCompletion(itemId, completed)`:
1. Toggle `order_items.completed`/`completed_at`.
2. Broadcast `item:updated` to the `kds` room regardless of outcome.
3. Fetch all items for the order; `allComplete = items.length > 0 && items.every(i => i.completed)`.
4. **If `allComplete` and the order isn't already locally `COMPLETED`:** `completeOrder(order)` —
   - `markOrderCompleted` (sets `state='COMPLETED'`, `ready_at=now()`).
   - `pushCompletionToSquare(order)`: refetches the order from Square (to get the *latest* version — the locally-stored version can be stale relative to Square if we haven't synced a concurrent edit), bails out with a logged warning if Square's order is already `COMPLETED`/`CANCELED` or has no fulfillment uid, otherwise calls `client.orders.update({ orderId, order: { locationId, version, fulfillments: [{ uid, state: "COMPLETED" }] } })`. **Failures here are logged only** — the local kitchen-facing completion is authoritative and is never rolled back because Square's push failed. There is no retry/reconciliation job (see Out of scope) — a failed push is a silent (logged) permanent divergence in v1.
   - `notificationService.notifyOrderReady(...)` (stub).
   - Broadcast `order:completed` to both rooms.
5. **If un-completing an item (`completed=false`) on an order that's already `COMPLETED`:** flip local `state` back to `IN_PROGRESS`, clear `ready_at`, log a warning. Square's fulfillment state is **not** reverted — Square disallows updating `COMPLETED`/`CANCELED` orders, so this is an accepted, explicitly-logged local/Square divergence, not a bug to "fix" by adding revert logic.

## REST API (`src/orders/orders.routes.ts`, mounted at `/api` in `app.ts`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/orders/active` | — | All `IN_PROGRESS` orders + items, oldest first. Powers the KDS screen. |
| GET | `/api/orders/:id` | — | Single order + items. 404 if not found. |
| PATCH | `/api/orders/:id/items/:itemId/complete` | `{ completed: boolean }` | Drives the completion flow above. Returns the updated order. |
| GET | `/api/display/summary` | — | `{ inProgress: [{id, displayNumber, createdAt}], nowServing: [{id, displayNumber, readyAt}] }`. `nowServing` = `COMPLETED` orders with `ready_at` in the last 15 minutes (hardcoded `NOW_SERVING_WINDOW_MINUTES` constant in `orders.routes.ts`). |
| POST | `/api/test/orders` | `{ items: [...], customerName?: string }` | Creates a **real** order in Square (catalog-based `{catalogObjectId, quantity, modifierCatalogObjectIds?}` items or ad-hoc `{name, quantity, priceAmountCents}` items), with a `PICKUP` fulfillment in `PROPOSED` state. Does **not** write to Postgres directly — relies on the resulting `order.created` webhook to exercise the real end-to-end path. Useful for local testing without a live POS. |

`GET /health` (mounted directly in `app.ts`, not under `/api`) returns `{ ok: true }` for basic liveness checks.

No auth on any endpoint.

## Socket.IO (`src/sockets/io.ts`)

Default namespace, two rooms: `kds`, `display`. A client connects, then emits `join` with `{ role: "kds" | "display" }`; the server does `socket.join(role)`. There are no other client→server events — all writes go through REST.

| Event | Room(s) | Payload |
|---|---|---|
| `order:created` | kds, display | `{ order: OrderWithItems }` |
| `order:updated` | kds, display | `{ order: OrderWithItems }` |
| `item:updated` | kds | `{ orderId, itemId, completed, completedAt }` |
| `order:completed` | kds, display | `{ orderId, displayNumber, readyAt }` |

`initSockets(httpServer)` must be called once at startup (done in `index.ts`) before any `broadcast*` helper is used; calling a broadcast helper before init logs a warning and no-ops rather than throwing.

## Notifications (`src/notifications/`)

```ts
interface NotificationService {
  notifyOrderReady(order: { squareOrderId: string; displayNumber: string | null }): Promise<void>;
}
```

`ConsoleNotificationService` (the only implementation) logs `[notify] Order #042 is ready for pickup.`. A real provider (Twilio, etc.) is a new class implementing this interface, swapped in wherever `consoleNotificationService.ts`'s exported `notificationService` singleton is imported (currently just `orderCompletion.service.ts`).

## Error handling / logging

Plain `console.log`/`console.error`, no logging library. `requestLogger` middleware logs one line per request. `errorHandler` is a standard 4-arg Express error middleware registered last in `app.ts`, responds `{ error: message }` with `err.statusCode ?? 500`. Route handlers are wrapped in `asyncHandler` so rejected promises reach `errorHandler` instead of crashing the process. Square API call failures inside services are caught at the call site and logged — they never fail an HTTP response that already succeeded locally.

## Square Node SDK integration notes (verified against the installed `square` package's actual `.d.ts` files, not just docs)

These were confirmed by reading `node_modules/square/api/types/*.d.ts` directly, because Context7's docs for this SDK were inconsistent/stale on a couple of these points:

- `squareClient.orders.get(...)`, `.create(...)`, `.update(...)` all return `core.HttpResponsePromise<T>` where `T` (`GetOrderResponse`/`CreateOrderResponse`/`UpdateOrderResponse`) has the order **directly** on `.order` — i.e. `const { order } = await squareClient.orders.get({ orderId })`. There is **no** `.result.order` wrapper despite some SDK doc examples showing that pattern (that pattern is stale/wrong for this installed version).
- `Order.version` is typed as `number`, not `bigint` (unlike `Money.amount`, which genuinely is `BigInt`). Don't wrap version in `BigInt(...)`.
- `Order.fulfillments` is `Square.Fulfillment[]` (the type is named `Fulfillment`, not `OrderFulfillment`, despite the REST field being `fulfillments`).
- `Fulfillment.state` values: `PROPOSED | RESERVED | PREPARED | COMPLETED | CANCELED | FAILED` (`FulfillmentState` const object). `Fulfillment.type`: `PICKUP | SHIPMENT | DELIVERY` (`FulfillmentType`).
- `FulfillmentPickupDetails.recipient` is a `FulfillmentRecipient` with `displayName` (not `recipient.name`).
- `OrderLineItemModifier` (not a bare `{name, catalogObjectId}`) has `uid`, `catalogObjectId`, `name`, `quantity`, `basePriceMoney`.
- `UpdateOrderRequest.order` is a full sparse `Order` object and **requires `locationId`** even for a version+fulfillments-only update, despite Square's own REST docs describing "sparse order objects" as needing only changed fields — the TS type enforces it regardless. `orderCompletion.service.ts`'s `pushCompletionToSquare` sets `locationId: order.square_location_id` for exactly this reason; omitting it is a compile error, not a runtime surprise.
- `WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl }): Promise<boolean>` — `requestBody` must be the raw string, `signatureHeader` must not be undefined (the wrapper in `square.webhook.verify.ts` returns `false` early if the header is missing, since the SDK's type requires a `string`, not `string | undefined`).
- Catalog-based line items on `orders.create` (`{ catalogObjectId, quantity, modifiers: [{ catalogObjectId }] }`) come back from `orders.get` with `name`/`variationName`/modifier `name` denormalized by Square — no separate Catalog API lookup was needed in testing so far. If this ever appears to return blank names, that's the first thing to check (fallback would be adding a Catalog API lookup/cache in `orderSync.service.ts`).

If the `square` package gets upgraded, re-verify these against `node_modules/square/api/types/*.d.ts` before trusting old assumptions — don't assume the shapes above are stable across major SDK versions.

## Explicitly out of scope (v1)

- Auth/authz on any endpoint or socket connection
- Multi-location support (single `SQUARE_LOCATION_ID` from env)
- Real SMS/push notification provider
- Payment processing
- Retry queues / dead-letter handling for failed webhook processing or failed Square pushes beyond a logged error
- A DB migration framework — hand-edit `db/schema.sql` and apply `ALTER`s by hand for now
- A reconciliation job to detect/fix orders where local state and Square state have diverged (e.g. after an "uncomplete" or a failed `orders.update`)
- Automated tests
- Rate limiting, CORS hardening (currently wide open, `origin: "*"` on the Socket.IO server)
- Daily reset/renumbering of `display_number` (it grows monotonically forever)

## Build / run

```
npm install
cp .env.example .env   # fill in real values
npm run db:init         # applies db/schema.sql via psql
npm run dev              # tsx watch src/index.ts
npm run build            # tsc -> dist/
npm start                # node dist/index.js
```

Verified so far: `tsc --noEmit` is clean, `npm run build` compiles, and the built server starts and responds on `/health` with placeholder env values. **Not yet verified**: an actual live Square sandbox order round-tripping through a real webhook subscription, or the completion flow against a real Postgres instance — do that before considering this production-ready. See `README.md` for the step-by-step manual test plan (create a sandbox webhook subscription, hit `POST /api/test/orders`, confirm it flows through to `GET /api/orders/active`, complete each item, confirm `order:completed` fires and the Square sandbox order's fulfillment shows `COMPLETED`).
