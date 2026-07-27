# printer-sim

Standalone local network printer simulator for the KDS's offline mode. Square's POS prints
kitchen tickets to a LAN printer with no cloud dependency for the print job itself — this
project impersonates a real Star Micronics network printer (discovery, status polling, and
print-data protocols), decodes what Square actually sends, and forwards parsed tickets to the
KDS server so the kitchen screen keeps working even if Square's API is unreachable.

Fully standalone: its own `package.json`, no dependency on or import from `../server`. The
only integration point is one HTTP call to the KDS server's `POST /api/printer-tickets`.

Square discovers and pairs with this exactly like a real Star printer — it advertises itself as
model **"TSP143IIILAN"** (the exact model name confirmed working with Square's discovery/
pairing flow; see `STAR_MODEL_NAME` below before renaming it). Real kitchen tickets arrive as
rasterized bitmap images (Square renders the whole ticket before sending — there's no plain
text in the wire payload at all), which get OCR'd back into structured ticket data.

## Setup

```
npm install
cp .env.example .env   # adjust ports / KDS_SERVER_URL if needed
```

**Also required: Tesseract OCR**, since real tickets arrive as bitmaps, not text.

```
winget install --id UB-Mannheim.TesseractOCR -e     # Windows
brew install tesseract                               # macOS
apt install tesseract-ocr                            # Linux
```

If it's not on your PATH at the default location, set `TESSERACT_PATH` in `.env`.

## Running

```
npm run dev
```

Starts all listeners at once:

| Protocol | Port | Purpose |
|---|---|---|
| UDP broadcast | 22222 | Star discovery (`STR_BCAST`) — makes this show up in Square's printer scan as a real Star device (default model name "TSP143IIILAN", see `STAR_MODEL_NAME`) |
| TCP | 9101 | Star ASB status polling — confirms print jobs completed (Square holds a job "queued/retrying" until this confirms) |
| TCP | 9100 | Raw print data — real tickets arrive here as Star raster bitmaps, decoded + OCR'd automatically |
| HTTP | 8008 | ePOS-Print XML (Epson-style) — a hedge in case a printer profile uses this instead; largely unused so far in practice |
| mDNS/Bonjour | 5353 | Secondary discovery hedge (AirPrint-style) — the UDP:22222 Star protocol is what actually matters here |

## How ticket decoding works

1. `starRaster.parser.ts` — decodes the Star Line Mode raster bitmap format: each scanline is
   a `0x62` ('b') + 2-byte length + N bytes of packed 1bpp pixel data record; walks the buffer
   sequentially rather than searching for `0x62` (which occurs constantly inside real pixel
   data and produces false record boundaries otherwise).
2. `rasterImage.ts` — renders decoded rows into a PNG (via `pngjs`), and segments it into
   contiguous "ink bands" (one per printed line) for more reliable per-line OCR than whole-page
   OCR (which sometimes drops or merges lines).
3. `ocr.ts` — shells out to the `tesseract` CLI (upscaled 3x first — native 203dpi thermal
   print resolution is too small for reliable OCR).
4. `starTicket.mapper.ts` — maps the OCR'd lines into `{ displayNumber, items }`: customer
   name/header, skip date/time and order-type lines, `N x Item Name` lines become items,
   everything else under an item becomes a modifier.
5. `tcp.listener.ts` wires this all together, and falls back to the older plain-text ESC/POS
   parser (`escpos.parser.ts` + `ticket.mapper.ts`) if a job contains no raster job at all.

## Verifying without a live Square/printer

```
npm run test:star    # unit tests for the Star discovery/status/ASB protocol byte-building
npm run test:send    # end-to-end: canned ESC/POS + ePOS-Print jobs through the real listeners
```

## Diagnostics

```
npm run capture
```

A separate raw logger (no parsing) — every TCP/HTTP/UDP byte that arrives gets dumped to
`captures/` and the console, plus verbose mDNS query/response logging. Useful if a new printer
profile, job type, or Square update starts behaving differently than what's documented above.

## Known limitations

- **Don't rename `STAR_MODEL_NAME` casually.** Tried rebranding it to a custom name once during
  development and Square's printer scan stopped showing the device at all — reverted back to
  `TSP143IIILAN` and it worked again immediately. Square's discovery may only surface
  certified/known model strings rather than treating this field as pure cosmetic text. Untested
  whether other real Star model names (e.g. other TSP variants) also work; don't assume an
  arbitrary string will.
- **OCR is heuristic, not structured data.** Expect occasional misreads on unusual item
  names/formatting, same caveat as any text-parsing approach — just applied to OCR output
  instead of raw ESC/POS text.
- **No reconciliation with the "real" Square order** once connectivity resumes — kitchen staff
  may see a duplicate ticket when Square's webhook backlog replays. See the KDS server's
  `AGENTS.md` and the offline-mode plan doc for the full rationale.
- **No job-type filtering.** Anything that arrives on the print port gets sent to the KDS,
  including non-kitchen jobs (e.g. shipping labels) if Square's printer routing sends them to
  the same profile — by design, per current requirements.
- **No auth on the KDS ingestion endpoint**, matching the KDS server's existing
  trusted-local-network stance.
