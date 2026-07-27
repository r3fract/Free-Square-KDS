import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { config } from "./env";
import { parseEscPos } from "./escpos.parser";
import { mapTicketLines } from "./ticket.mapper";
import { sendTicketToKds } from "./kdsClient";
import { recordPrintJobEtb } from "./star.state";
import { processRasterPrintJob } from "./rasterTicket.ingest";

const capturesDir = path.join(__dirname, "..", "captures");

function hexDump(buf: Buffer): string {
  const lines: string[] = [];
  for (let offset = 0; offset < buf.length; offset += 16) {
    const chunk = buf.subarray(offset, offset + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

function saveRawJob(buffer: Buffer, remote: string): string {
  fs.mkdirSync(capturesDir, { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, "-")}_tcp9100`;
  fs.writeFileSync(path.join(capturesDir, `${base}.bin`), buffer);
  fs.writeFileSync(
    path.join(capturesDir, `${base}.txt`),
    `Source: ${remote}\n-- ${buffer.length} bytes --\n${hexDump(buffer)}`
  );
  return base;
}

export function startTcpListener(): net.Server {
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;

    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", (err) => console.error(`[tcp] socket error from ${remote}:`, err));
    socket.on("close", () => {
      if (chunks.length === 0) return;
      const buffer = Buffer.concat(chunks);
      const base = saveRawJob(buffer, remote);
      // Any completed print job is treated as reason to confirm ETB-executed on the next
      // status polls — we're not fully certain the specific byte we originally keyed off is
      // truly the trigger condition, so this is deliberately unconditional as a safety net.
      recordPrintJobEtb();
      console.log(`[tcp] connection from ${remote} closed, ${buffer.length} bytes -> captures/${base}.{bin,txt}`);

      // Real tickets in this setup arrive as rasterized bitmaps (Square renders the whole
      // receipt before sending), not plain ESC/POS text — try that path first via OCR, and
      // only fall back to the plain-text parser if no raster job is present in this buffer.
      processRasterPrintJob(buffer)
        .then((rasterJobCount) => {
          if (rasterJobCount > 0) return;
          const rawTickets = parseEscPos(buffer);
          console.log(`[tcp] no raster job found, fell back to text parser: decoded ${rawTickets.length} ticket(s)`);
          for (const raw of rawTickets) {
            sendTicketToKds(mapTicketLines(raw)).catch((err) =>
              console.error("[tcp] failed to send ticket to KDS:", err)
            );
          }
        })
        .catch((err) => console.error("[tcp] failed to process print job:", err));
    });
  });

  server.listen(config.PRINTER_TCP_PORT, () => {
    console.log(`[tcp] ESC/POS printer listener on port ${config.PRINTER_TCP_PORT}`);
  });

  return server;
}
