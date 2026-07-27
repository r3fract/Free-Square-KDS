import * as http from "http";
import { config } from "./env";
import { parseEposPrintXml } from "./eposxml.parser";
import { mapTicketLines } from "./ticket.mapper";
import { sendTicketToKds } from "./kdsClient";

const SUCCESS_RESPONSE =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<s:Body><response success="true" code="" status="0" battery="0"/></s:Body>' +
  "</s:Envelope>";

export function startHttpListener(): http.Server {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const rawTickets = parseEposPrintXml(body);
      console.log(`[http] ${req.method} ${req.url} decoded ${rawTickets.length} ticket(s) from ${body.length} bytes`);
      for (const raw of rawTickets) {
        sendTicketToKds(mapTicketLines(raw)).catch((err) =>
          console.error("[http] failed to send ticket to KDS:", err)
        );
      }
      res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
      res.end(SUCCESS_RESPONSE);
    });
    req.on("error", (err) => console.error("[http] request error:", err));
  });

  server.listen(config.PRINTER_HTTP_PORT, () => {
    console.log(`[http] ePOS-Print XML listener on port ${config.PRINTER_HTTP_PORT}`);
  });

  return server;
}
