/**
 * Maps OCR'd lines from a decoded Star raster ticket (one line per ink band — see
 * rasterImage.ts's findInkBands) into { displayNumber, items }. Real captured format:
 *
 *   <Customer Name>            <- header, becomes displayNumber
 *   <date>            <time>   <- skipped
 *   Recipient:                 <- skipped (label)
 *   <Customer Name>            <- skipped (repeats the header)
 *   FOR HERE                   <- order type, skipped (not modeled yet)
 *   1 x Chicken Strips (6pc)   <- item
 *   No Sauce                   <- modifier
 *   Honey Dill                 <- modifier
 *   1x Hot Dog                 <- item
 *   Regular                    <- modifier
 *
 * Same lossy-by-nature caveat as ticket.mapper.ts: this is heuristic text parsing of OCR
 * output, not structured data — expect occasional misreads on unusual item names/formatting.
 */
import type { ParsedTicket, ParsedTicketItem } from "./printer.types";

const QUANTITY_WITH_X = /^(\d+)\s*[xX]\s*(.+)$/;
const DATE_TIME_LINE = /\d{1,2}:\d{2}(:\d{2})?\s*[AP]M/i;
const RECIPIENT_LABEL = /^recipient:?$/i;
const ORDER_TYPE_WORDS = /^(for here|to go|dine in|take ?out|pickup|delivery)$/i;

function parseItemLine(line: string): { name: string; quantity: string } | null {
  const match = line.match(QUANTITY_WITH_X);
  return match ? { quantity: match[1], name: match[2].trim() } : null;
}

export function mapOcrLines(rawLines: string[]): ParsedTicket {
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);

  let displayNumber: string | null = null;
  const items: ParsedTicketItem[] = [];
  let current: ParsedTicketItem | null = null;

  for (const line of lines) {
    if (DATE_TIME_LINE.test(line)) continue;
    if (RECIPIENT_LABEL.test(line)) continue;
    if (ORDER_TYPE_WORDS.test(line)) continue;

    if (displayNumber === null) {
      displayNumber = line;
      continue;
    }
    if (line === displayNumber) continue; // the repeated "Recipient: <name>" line

    const item = parseItemLine(line);
    if (item) {
      if (current) items.push(current);
      current = { name: item.name, quantity: item.quantity, modifiers: [], note: null };
    } else if (current) {
      current.modifiers.push(line);
    }
  }
  if (current) items.push(current);

  return { displayNumber, items };
}
