import { config } from "./env";
import type { ParsedTicket } from "./printer.types";

export async function sendTicketToKds(ticket: ParsedTicket): Promise<void> {
  if (ticket.items.length === 0) {
    console.warn("[kdsClient] parsed ticket has no items, skipping send:", ticket);
    return;
  }

  const url = `${config.KDS_SERVER_URL}/api/printer-tickets`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket),
    });
    if (!response.ok) {
      console.error(`[kdsClient] KDS server rejected ticket (${response.status}):`, await response.text());
      return;
    }
    console.log(`[kdsClient] sent ticket "${ticket.displayNumber ?? "?"}" (${ticket.items.length} items) to ${url}`);
  } catch (err) {
    console.error(`[kdsClient] failed to reach KDS server at ${url}:`, err);
  }
}
