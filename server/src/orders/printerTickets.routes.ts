import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ingestPrinterTicket } from "./printerTicket.service";

const itemSchema = z.object({
  name: z.string().min(1),
  quantity: z.string().min(1).default("1"),
  modifiers: z.array(z.string()).default([]),
  note: z.string().nullable().default(null),
});

const ticketSchema = z.object({
  displayNumber: z.string().nullable().default(null),
  items: z.array(itemSchema).min(1),
});

export const printerTicketsRouter = Router();

// Ingestion endpoint for printer-sim/ (see that project's README) — a ticket parsed off
// Square's local print traffic, not a real Square order. No auth, matching this app's
// existing "trusted local network" stance for every other endpoint/socket.
printerTicketsRouter.post(
  "/printer-tickets",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid printer ticket payload", details: parsed.error.flatten() });
      return;
    }

    const order = await ingestPrinterTicket(parsed.data);
    res.status(201).json({ order });
  })
);
