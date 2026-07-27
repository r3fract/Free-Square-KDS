import cors from "cors";
import express, { type Express } from "express";
import { squareWebhookRouter } from "./webhooks/square.webhook.routes";
import { ordersRouter } from "./orders/orders.routes";
import { printerTicketsRouter } from "./orders/printerTickets.routes";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { corsOrigin } from "./config/cors";

export function createApp(): Express {
  const app = express();

  app.use(requestLogger);
  app.use(cors({ origin: corsOrigin }));

  // Webhook route needs the raw request body for signature verification, so it
  // must be mounted (with its own express.raw middleware) before the global
  // express.json() parser below.
  app.use("/webhooks", squareWebhookRouter);

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", ordersRouter);
  app.use("/api", printerTicketsRouter);

  app.use(errorHandler);

  return app;
}
