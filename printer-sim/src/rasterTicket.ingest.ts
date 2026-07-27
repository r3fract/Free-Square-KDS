import { findAndDecodeRasterJobs } from "./starRaster.parser";
import { findInkBands, renderRowRangeToPng, upscalePng } from "./rasterImage";
import { ocrPng } from "./ocr";
import { mapOcrLines } from "./starTicket.mapper";
import { sendTicketToKds } from "./kdsClient";

const OCR_UPSCALE_FACTOR = 3;

/** Real kitchen tickets from Square (in this setup) arrive as rasterized bitmaps, not plain
 * ESC/POS text — see starRaster.parser.ts. Decodes each raster job in the buffer, OCRs it one
 * ink-band ("line") at a time (more reliable than whole-page OCR, which sometimes drops or
 * merges lines), maps the resulting lines into a ticket, and forwards it to the KDS. Returns
 * the number of raster jobs found (0 means this buffer wasn't a raster job at all). */
export async function processRasterPrintJob(buffer: Buffer): Promise<number> {
  const jobs = findAndDecodeRasterJobs(buffer);

  for (const job of jobs) {
    const bands = findInkBands(job);
    const lines: string[] = [];

    for (const band of bands) {
      const png = renderRowRangeToPng(job, band.startRow, band.endRow);
      const upscaled = upscalePng(png, OCR_UPSCALE_FACTOR);
      const text = await ocrPng(upscaled);
      if (text) lines.push(text);
    }

    console.log(`[raster] decoded job: ${job.rows.length} rows, ${bands.length} ink bands, OCR lines: ${JSON.stringify(lines)}`);

    const ticket = mapOcrLines(lines);
    if (ticket.items.length > 0) {
      await sendTicketToKds(ticket);
    } else {
      console.warn("[raster] decoded raster job produced no items, skipping KDS send");
    }
  }

  return jobs.length;
}
