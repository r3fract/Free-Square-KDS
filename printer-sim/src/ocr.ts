import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { config } from "./env";

const execFileAsync = promisify(execFile);

/** Runs tesseract on a PNG buffer and returns the extracted text. Shells out to the tesseract
 * CLI directly (the same thing Python's pytesseract does under the hood) rather than pulling in
 * a native OCR binding — no extra native build step, and the binary's already required either
 * way. */
export async function ocrPng(pngBuffer: Buffer, psm = 6): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `printer-sim-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmpFile, pngBuffer);
  try {
    const { stdout } = await execFileAsync(config.TESSERACT_PATH, [
      tmpFile,
      "stdout",
      "--psm",
      String(psm),
    ]);
    return stdout.trim();
  } finally {
    fs.unlinkSync(tmpFile);
  }
}
