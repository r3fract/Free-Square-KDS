import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PRINTER_TCP_PORT: z.coerce.number().default(9100),
  PRINTER_HTTP_PORT: z.coerce.number().default(8008),
  KDS_SERVER_URL: z.string().url().default("http://localhost:3000"),
  // Escape hatch for multi-adapter machines where auto-detection (network.util.ts) picks the
  // wrong interface (VPN, virtual switch, a disconnected NIC's link-local 169.254.x.x address,
  // etc.) — set this to the IP actually on the same LAN as the Square device.
  ADVERTISE_IP: z.string().optional(),
  // Model name advertised in Star discovery responses — defaults to the exact model name
  // confirmed working with Square's discovery/pairing flow in testing. Renaming this to
  // something else (e.g. for branding) is untested — Square's app may only surface
  // certified/known model strings in its printer list rather than treating this as pure
  // cosmetic text, so a rename can cause the device to stop appearing even though the
  // underlying protocol responses are otherwise identical.
  STAR_MODEL_NAME: z.string().default("TSP143IIILAN"),
  // Path to the tesseract OCR binary — real kitchen tickets arrive as rasterized bitmaps (no
  // plain text in the payload at all), so OCR is required to extract order content.
  TESSERACT_PATH: z.string().default(
    process.platform === "win32" ? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe" : "tesseract"
  ),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
