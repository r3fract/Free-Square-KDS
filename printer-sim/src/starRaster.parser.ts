/**
 * Decoder for Star Micronics line-mode raster print jobs (TSP100/TSP143 family) — this is what
 * Square actually sends for BOTH test prints and real kitchen tickets in this setup: the host
 * rasterizes the whole receipt into a bitmap before sending, there is no plain ESC/POS text in
 * the payload at all. Confirmed against real captures (verified via a Python prototype with
 * Tesseract OCR, whose output exactly matched a real placed order).
 *
 * Structure:
 *   ESC*rB  (1B 2A 72 42)        quit raster
 *   ESC GS 03 ...                status setup
 *   (ESC ACK SOH) x N            real-time status polls
 *   ESC*rA  (1B 2A 72 41)        enter raster mode
 *   ESC*rR  (1B 2A 72 52)        init
 *   ESC*rP '0' NUL               continuous page mode
 *   ESC*rE n NUL                 (per-job header)
 *   <raster records>
 *   ESC*rB                       quit raster + trailing status bytes
 *
 * Each raster record is: 0x62 ('b'), n_lo, n_hi, then n bytes of packed 1bpp pixel data for ONE
 * scan line (MSB = leftmost dot, 1 = black). n is read from the record, not assumed (576 dots /
 * 72mm-wide paper at 203dpi is common: n=72, but don't hardcode it). ESC*rY n NUL (vertical
 * skip) inserts n blank rows if present.
 *
 * IMPORTANT: walk the buffer sequentially and only treat a 0x62 byte as a record header when it
 * validates (consistent width, in-bounds) — 'b' occurs constantly inside real pixel data and a
 * naive Buffer.indexOf(0x62) scan produces false positives.
 */

const ESC = 0x1b;
const STAR_R_A = Buffer.from([ESC, 0x2a, 0x72, 0x41]);
const STAR_R_B = Buffer.from([ESC, 0x2a, 0x72, 0x42]);
const STAR_R_Y = Buffer.from([ESC, 0x2a, 0x72, 0x59]);
const RECORD_MARKER = 0x62;

export interface RasterJob {
  rows: Buffer[];
  widthBytes: number;
}

/** Finds each ESC*rA ... ESC*rB span in the buffer — a print job can contain more than one
 * raster job (e.g. a logo followed by a text-rendered body). */
export function findRasterJobSpans(buffer: Buffer): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let pos = 0;
  while (pos < buffer.length) {
    const start = buffer.indexOf(STAR_R_A, pos);
    if (start === -1) break;
    let end = buffer.indexOf(STAR_R_B, start);
    end = end === -1 ? buffer.length : end + STAR_R_B.length;
    spans.push([start, end]);
    pos = end;
  }
  return spans;
}

export function decodeRasterJob(jobBuffer: Buffer): RasterJob {
  const rows: Buffer[] = [];
  let widthBytes: number | null = null;
  let i = 0;

  while (i < jobBuffer.length) {
    if (jobBuffer[i] === ESC && jobBuffer.subarray(i, i + 4).equals(STAR_R_Y) && i + 5 < jobBuffer.length) {
      const skipN = jobBuffer[i + 4];
      if (widthBytes !== null) {
        for (let n = 0; n < skipN; n++) rows.push(Buffer.alloc(widthBytes));
      }
      i += 6;
      continue;
    }

    if (jobBuffer[i] === ESC) {
      if (jobBuffer.subarray(i, i + 4).equals(STAR_R_B)) break;
      i += 1;
      continue;
    }

    if (jobBuffer[i] === RECORD_MARKER && i + 3 <= jobBuffer.length) {
      const nLo = jobBuffer[i + 1];
      const nHi = jobBuffer[i + 2];
      const n = nLo | (nHi << 8);
      const dataStart = i + 3;
      const dataEnd = dataStart + n;
      if (n > 0 && dataEnd <= jobBuffer.length && (widthBytes === null || n === widthBytes)) {
        if (widthBytes === null) widthBytes = n;
        rows.push(jobBuffer.subarray(dataStart, dataEnd));
        i = dataEnd;
        continue;
      }
    }

    i += 1;
  }

  return { rows, widthBytes: widthBytes ?? 0 };
}

export function findAndDecodeRasterJobs(buffer: Buffer): RasterJob[] {
  return findRasterJobSpans(buffer)
    .map(([start, end]) => decodeRasterJob(buffer.subarray(start, end)))
    .filter((job) => job.rows.length > 0 && job.widthBytes > 0);
}
