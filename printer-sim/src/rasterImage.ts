import { PNG } from "pngjs";
import type { RasterJob } from "./starRaster.parser";

/** Renders decoded raster rows into a 1-bit-per-pixel PNG buffer at native resolution, then
 * (separately) an upscaled grayscale copy — OCR engines do much better on upscaled images than
 * native 203dpi thermal-printer resolution. */
export function renderRasterToPng(job: RasterJob): Buffer {
  const widthPx = job.widthBytes * 8;
  const heightPx = job.rows.length;
  const png = new PNG({ width: widthPx, height: heightPx, colorType: 0 });

  for (let y = 0; y < heightPx; y++) {
    const row = job.rows[y];
    for (let xByte = 0; xByte < job.widthBytes; xByte++) {
      const byteVal = xByte < row.length ? row[xByte] : 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const isBlack = (byteVal >> (7 - bit)) & 1;
        const idx = (widthPx * y + x) << 2;
        const value = isBlack ? 0 : 255;
        png.data[idx] = value;
        png.data[idx + 1] = value;
        png.data[idx + 2] = value;
        png.data[idx + 3] = 255;
      }
    }
  }

  return PNG.sync.write(png);
}

/** Nearest-neighbor upscale — cheap and sufficient for OCR on a 1-bit source image (no
 * fractional-pixel blending to get right, unlike upscaling a photo). */
export function upscalePng(pngBuffer: Buffer, factor: number): Buffer {
  const src = PNG.sync.read(pngBuffer);
  const out = new PNG({ width: src.width * factor, height: src.height * factor, colorType: 0 });

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const srcIdx = (src.width * y + x) << 2;
      const r = src.data[srcIdx];
      const g = src.data[srcIdx + 1];
      const b = src.data[srcIdx + 2];
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const dstX = x * factor + sx;
          const dstY = y * factor + sy;
          const dstIdx = (out.width * dstY + dstX) << 2;
          out.data[dstIdx] = r;
          out.data[dstIdx + 1] = g;
          out.data[dstIdx + 2] = b;
          out.data[dstIdx + 3] = 255;
        }
      }
    }
  }

  return PNG.sync.write(out);
}

export interface InkBand {
  startRow: number;
  endRow: number;
  maxDensity: number;
}

/** Per-row ink density -> contiguous non-blank bands, used to crop+OCR one ticket "line" (or
 * tight group of lines) at a time — whole-page OCR sometimes drops or merges lines. */
export function findInkBands(job: RasterJob): InkBand[] {
  const bands: InkBand[] = [];
  let bandStart: number | null = null;
  let bandMax = 0;

  for (let y = 0; y < job.rows.length; y++) {
    const row = job.rows[y];
    let count = 0;
    for (const byte of row) {
      let b = byte;
      while (b) {
        count += b & 1;
        b >>= 1;
      }
    }

    if (count > 0) {
      if (bandStart === null) {
        bandStart = y;
        bandMax = count;
      } else {
        bandMax = Math.max(bandMax, count);
      }
    } else if (bandStart !== null) {
      bands.push({ startRow: bandStart, endRow: y - 1, maxDensity: bandMax });
      bandStart = null;
      bandMax = 0;
    }
  }
  if (bandStart !== null) {
    bands.push({ startRow: bandStart, endRow: job.rows.length - 1, maxDensity: bandMax });
  }

  return bands;
}

/** Renders just the given row range (with a little padding) as its own PNG, for per-band OCR. */
export function renderRowRangeToPng(job: RasterJob, startRow: number, endRow: number, pad = 4): Buffer {
  const top = Math.max(0, startRow - pad);
  const bottom = Math.min(job.rows.length, endRow + 1 + pad);
  const cropped: RasterJob = { rows: job.rows.slice(top, bottom), widthBytes: job.widthBytes };
  return renderRasterToPng(cropped);
}
