/** One printed job's worth of plain text lines, delimited by whatever the source protocol
 * considers a job boundary (an ESC/POS cut command, an ePOS-Print <cut/>, or a closed TCP
 * connection). Parsers only extract text + boundaries — turning lines into
 * { displayNumber, items } is ticket.mapper.ts's job, kept separate so the heuristics can be
 * iterated on independently of the byte/XML-level decoding. */
export interface RawTicketLines {
  lines: string[];
}

export interface ParsedTicketItem {
  name: string;
  quantity: string;
  modifiers: string[];
  note: string | null;
}

export interface ParsedTicket {
  displayNumber: string | null;
  items: ParsedTicketItem[];
}
