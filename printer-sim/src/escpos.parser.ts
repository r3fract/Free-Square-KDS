/**
 * Minimal hand-rolled ESC/POS byte-level parser.
 *
 * Scope, deliberately: text + job-boundary detection only. No barcode/QR/image rendering,
 * no code-page-accurate glyph mapping (defaults to latin1, which is a reasonable v1
 * approximation for ASCII-range ticket text — revisit once Step 0's real captures show the
 * actual code page in use). ESC/POS is not a formally standardized protocol and Star
 * Micronics printers commonly run their own "StarPRNT"/"Star Line Mode" dialect rather than
 * pure Epson ESC/POS, so any command sequence we don't recognize is skipped via a resync
 * (scan forward to the next line-feed or next ESC/GS/FS lead byte) instead of aborting —
 * we may lose a barcode/logo block we don't care about anyway, but we keep parsing the rest
 * of the ticket's text.
 */
import type { RawTicketLines } from "./printer.types";

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const LF = 0x0a;
const CR = 0x0d;

// Operand byte count following the command byte, for fixed-length ESC/GS sequences we
// recognize. Anything not listed here falls through to resyncFromUnknown().
const ESC_FIXED_OPERANDS: Record<number, number> = {
  0x40: 0, // initialize printer
  0x45: 1, // bold on/off (n)
  0x2d: 1, // underline (n)
  0x61: 1, // justification (n)
  0x64: 1, // feed n lines (n)
  0x32: 0, // default line spacing
  0x33: 1, // custom line spacing (n)
  0x70: 3, // cash drawer kick (m, t1, t2)
  0x74: 1, // code page select (n)
  0x52: 1, // international charset (n)
};

const GS_FIXED_OPERANDS: Record<number, number> = {
  0x21: 1, // character size (n)
};

export function parseEscPos(buffer: Buffer): RawTicketLines[] {
  const tickets: RawTicketLines[] = [];
  let lines: string[] = [];
  let currentLine: number[] = [];

  function pushLine(): void {
    if (currentLine.length > 0 || lines.length > 0) {
      lines.push(Buffer.from(currentLine).toString("latin1"));
    }
    currentLine = [];
  }

  function endTicket(): void {
    pushLine();
    // Require at least one actual printable character — a stray control/null byte (e.g. a
    // single 0x00 from an incomplete/probe connection) survives `.trim()` since JS doesn't
    // treat it as whitespace, which previously produced bogus single-byte "tickets".
    if (lines.some((line) => /[\x20-\x7e]/.test(line))) {
      tickets.push({ lines: [...lines] });
    }
    lines = [];
  }

  let i = 0;
  while (i < buffer.length) {
    const start = i;
    const byte = buffer[i];

    if (byte === ESC && i + 1 < buffer.length) {
      const cmd = buffer[i + 1];
      const operandLen = ESC_FIXED_OPERANDS[cmd];
      i = operandLen !== undefined ? i + 2 + operandLen : resyncFromUnknown(buffer, i, "ESC");
    } else if (byte === GS && i + 1 < buffer.length) {
      i = handleGs(buffer, i, endTicket);
    } else if (byte === FS && i + 1 < buffer.length) {
      i = resyncFromUnknown(buffer, i, "FS");
    } else if (byte === LF) {
      pushLine();
      i += 1;
    } else if (byte === CR) {
      // CRLF: let the following LF push the line; a bare CR pushes now.
      if (buffer[i + 1] !== LF) pushLine();
      i += 1;
    } else {
      currentLine.push(byte);
      i += 1;
    }

    // Safety net: a malformed/truncated sequence must never fail to advance.
    if (!Number.isFinite(i) || i <= start) i = start + 1;
  }

  endTicket();
  return tickets;
}

function handleGs(buffer: Buffer, i: number, endTicket: () => void): number {
  const cmd = buffer[i + 1];

  if (cmd === 0x56) {
    // GS V m (cut), or GS V 'A'/'B' n (feed-then-cut variant)
    const m = buffer[i + 2];
    const isFeedVariant = m === 0x41 || m === 0x42;
    endTicket();
    return i + (isFeedVariant ? 4 : 3);
  }

  if (cmd === 0x28 && buffer[i + 2] === 0x6b) {
    // GS ( k  pL pH cn fn [data...] — length-prefixed function family (2D barcode/QR/etc)
    const pL = buffer[i + 3];
    const pH = buffer[i + 4];
    if (pL === undefined || pH === undefined) return buffer.length;
    return i + 5 + pL + pH * 256;
  }

  const operandLen = GS_FIXED_OPERANDS[cmd];
  if (operandLen !== undefined) return i + 2 + operandLen;

  return resyncFromUnknown(buffer, i, "GS");
}

function resyncFromUnknown(buffer: Buffer, start: number, label: string): number {
  let j = start + 2;
  while (j < buffer.length && buffer[j] !== LF && buffer[j] !== ESC && buffer[j] !== GS && buffer[j] !== FS) {
    j += 1;
  }
  console.warn(
    `[escpos] unknown ${label} command 0x${buffer[start + 1]?.toString(16) ?? "??"}, skipped ${j - start} bytes`
  );
  return j;
}
