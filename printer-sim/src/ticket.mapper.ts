/**
 * Heuristic text -> { displayNumber, items } extraction, shared by both protocol parsers.
 *
 * This is inherently lossy compared to Square's structured API line items — printed ticket
 * formatting (indentation, bold/size cues for modifiers) isn't guaranteed stable across
 * printer models/profiles. Expect occasional missed modifiers or misparsed quantities as a
 * standing property of this path, not a bug to eventually eliminate. Rewrite these patterns
 * once Step 0's real captures show actual Square ticket formatting.
 */
import type { ParsedTicket, ParsedTicketItem, RawTicketLines } from "./printer.types";

const DISPLAY_NUMBER_PATTERNS = [
  /\border\s*#?\s*([A-Za-z0-9-]+)/i,
  /\bticket\s*#?\s*([A-Za-z0-9-]+)/i,
  /^\s*#\s*([A-Za-z0-9-]+)\s*$/,
];

const QUANTITY_WITH_X = /^(\d+)\s*[xX]\s*(.+)$/; // "2x Cheeseburger"
const QUANTITY_LEADING = /^(\d+)\s+(.+)$/; // "2 Cheeseburger"

function extractDisplayNumber(lines: string[]): { displayNumber: string | null; consumedIndex: number } {
  const searchDepth = Math.min(lines.length, 6);
  for (let idx = 0; idx < searchDepth; idx++) {
    const line = lines[idx];
    if (!line || !line.trim()) continue;
    for (const pattern of DISPLAY_NUMBER_PATTERNS) {
      const match = line.match(pattern);
      if (match) return { displayNumber: match[1], consumedIndex: idx };
    }
  }
  return { displayNumber: null, consumedIndex: -1 };
}

function parseItemLine(line: string): { name: string; quantity: string } {
  const trimmed = line.trim();
  const withX = trimmed.match(QUANTITY_WITH_X);
  if (withX) return { quantity: withX[1], name: withX[2].trim() };
  const leading = trimmed.match(QUANTITY_LEADING);
  if (leading) return { quantity: leading[1], name: leading[2].trim() };
  return { quantity: "1", name: trimmed };
}

export function mapTicketLines(ticket: RawTicketLines): ParsedTicket {
  const { lines } = ticket;
  const { displayNumber, consumedIndex } = extractDisplayNumber(lines);

  const items: ParsedTicketItem[] = [];
  let current: ParsedTicketItem | null = null;

  lines.forEach((rawLine, idx) => {
    if (idx === consumedIndex) return;
    if (!rawLine || !rawLine.trim()) return;

    const isIndented = /^[ \t]/.test(rawLine);
    if (isIndented && current) {
      current.modifiers.push(rawLine.trim());
      return;
    }

    if (current) items.push(current);
    const { name, quantity } = parseItemLine(rawLine);
    current = { name, quantity, modifiers: [], note: null };
  });

  if (current) items.push(current);

  return { displayNumber, items };
}
