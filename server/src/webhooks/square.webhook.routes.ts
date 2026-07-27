import { Router, raw, type Request, type Response } from "express";
import { verifySquareSignature } from "./square.webhook.verify";
import { syncFromSquareOrderId } from "../orders/orderSync.service";

const ORDER_EVENT_TYPES = new Set([
  "order.created",
  "order.updated",
  "order.fulfillment.updated",
]);

export const squareWebhookRouter = Router();

squareWebhookRouter.post(
  "/square",
  raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const rawBody = (req.body as Buffer).toString("utf8");
    const signatureHeader = req.header("x-square-hmacsha256-signature");

    const isValid = await verifySquareSignature(rawBody, signatureHeader);
    if (!isValid) {
      console.warn("[webhook] Invalid Square webhook signature");
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    let event: { type?: string; data?: { id?: string } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    res.status(200).json({ acknowledged: true });

    if (!event.type || !ORDER_EVENT_TYPES.has(event.type) || !event.data?.id) {
      return;
    }

    syncFromSquareOrderId(event.data.id).catch((err) => {
      console.error(`[webhook] Failed to process ${event.type} for order ${event.data?.id}:`, err);
    });
  }
);
