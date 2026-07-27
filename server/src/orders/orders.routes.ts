import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { OrderLineItem } from "square";
import { squareClient } from "../square/client";
import { config } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { recallOrder, setItemCompletion } from "./orderCompletion.service";
import { getActiveOrders, getCompletedOrders, getNowServing, getOrderWithItems } from "./orders.repository";

export const ordersRouter = Router();

const NOW_SERVING_WINDOW_MINUTES = 15;

ordersRouter.get(
  "/orders/active",
  asyncHandler(async (_req: Request, res: Response) => {
    const orders = await getActiveOrders();
    res.json({ orders });
  })
);

const DEFAULT_COMPLETED_LIMIT = 50;
const MAX_COMPLETED_LIMIT = 200;

ordersRouter.get(
  "/orders/completed",
  asyncHandler(async (req: Request, res: Response) => {
    const requested = Number(req.query.limit);
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_COMPLETED_LIMIT)
      : DEFAULT_COMPLETED_LIMIT;
    const orders = await getCompletedOrders(limit);
    res.json({ orders });
  })
);

ordersRouter.get(
  "/orders/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await getOrderWithItems(orderId);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ order });
  })
);

const completeItemSchema = z.object({ completed: z.boolean() });

ordersRouter.patch(
  "/orders/:id/items/:itemId/complete",
  asyncHandler(async (req: Request, res: Response) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId)) {
      res.status(400).json({ error: "Invalid item id" });
      return;
    }
    const parsed = completeItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { completed: boolean }" });
      return;
    }
    await setItemCompletion(itemId, parsed.data.completed);
    const orderId = Number(req.params.id);
    const order = await getOrderWithItems(orderId);
    res.json({ order });
  })
);

ordersRouter.post(
  "/orders/:id/recall",
  asyncHandler(async (req: Request, res: Response) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await recallOrder(orderId);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ order });
  })
);

ordersRouter.get(
  "/display/summary",
  asyncHandler(async (_req: Request, res: Response) => {
    const [inProgress, nowServing] = await Promise.all([
      getActiveOrders(),
      getNowServing(NOW_SERVING_WINDOW_MINUTES),
    ]);

    res.json({
      inProgress: inProgress.map((o) => ({
        id: o.id,
        displayNumber: o.display_number,
        createdAt: o.created_at,
      })),
      nowServing: nowServing.map((o) => ({
        id: o.id,
        displayNumber: o.display_number,
        readyAt: o.ready_at,
      })),
    });
  })
);

const catalogItemSchema = z.object({
  catalogObjectId: z.string(),
  quantity: z.string().default("1"),
  modifierCatalogObjectIds: z.array(z.string()).optional(),
});

const adHocItemSchema = z.object({
  name: z.string(),
  quantity: z.string().default("1"),
  priceAmountCents: z.number().int().positive(),
});

const testOrderSchema = z.object({
  items: z.array(z.union([catalogItemSchema, adHocItemSchema])).min(1),
  customerName: z.string().optional(),
});

// Creates a real order in Square for local testing (exercises the full webhook -> sync path).
// Disabled in production so this test-only surface isn't reachable outside dev/staging.
if (config.NODE_ENV !== "production") {
ordersRouter.post(
  "/test/orders",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = testOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const lineItems: OrderLineItem[] = parsed.data.items.map((item) => {
      if ("catalogObjectId" in item) {
        return {
          catalogObjectId: item.catalogObjectId,
          quantity: item.quantity,
          modifiers: item.modifierCatalogObjectIds?.map((catalogObjectId) => ({
            catalogObjectId,
          })),
        };
      }
      return {
        name: item.name,
        quantity: item.quantity,
        basePriceMoney: { amount: BigInt(item.priceAmountCents), currency: "USD" },
      };
    });

    const response = await squareClient.orders.create({
      order: {
        locationId: config.SQUARE_LOCATION_ID,
        lineItems,
        fulfillments: [
          {
            type: "PICKUP",
            state: "PROPOSED",
            pickupDetails: {
              recipient: { displayName: parsed.data.customerName ?? "Guest" },
            },
          },
        ],
      },
      idempotencyKey: randomUUID(),
    });

    res.status(201).json({ squareOrderId: response.order?.id });
  })
);
}
