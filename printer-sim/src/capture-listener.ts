/**
 * Step 0 diagnostic tool: don't parse anything, just prove what Square actually sends.
 *
 * Listens on several candidate ports at once, not just the ones we guessed as primary
 * (PRINTER_TCP_PORT/PRINTER_HTTP_PORT) — a live test against a real Square POS showed zero
 * connection attempts on 9100 or 8008 when using Square's "Advanced printer setup" manual-IP
 * entry, which (combined with Windows Firewall already allowing node.exe on any port) points
 * at Square simply trying a different port than the ones we assumed. Common candidates for a
 * "network printer" manual entry: 9100 (raw/JetDirect, our primary guess), 9101 (Star's ASB
 * status port, seen in prior reverse-engineering of Star network printers), 631 (IPP, what
 * AirPrint-style discovery/printing actually speaks), 80 (Epson ePOS-Print's conventional
 * default — we picked 8008 for the "real" listener to dodge privileged-port assumptions that
 * don't actually apply on Windows, but the capture tool should still watch 80 in case that's
 * what's expected).
 */
import * as dgram from "dgram";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as path from "path";
import { config } from "./env";
import { startMdns } from "./mdns";

const TCP_CAPTURE_PORTS = Array.from(new Set([config.PRINTER_TCP_PORT, 9100, 9101]));
const HTTP_CAPTURE_PORTS = Array.from(new Set([config.PRINTER_HTTP_PORT, 80, 631]));
// Star Micronics printers (Square's own recommended network printer hardware) use a
// proprietary UDP broadcast discovery protocol on port 22222 ("STR_BCAST" magic string query,
// 302-byte identity response) instead of mDNS — this is a much stronger lead than the mDNS
// work, so watch for it explicitly.
const UDP_CAPTURE_PORTS = [22222];

const capturesDir = path.join(__dirname, "..", "captures");
fs.mkdirSync(capturesDir, { recursive: true });

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

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

function saveCapture(label: string, raw: Buffer, extra?: string): void {
  const base = `${timestamp()}_${label}`;
  fs.writeFileSync(path.join(capturesDir, `${base}.bin`), raw);
  const dump = [extra ? `${extra}\n` : "", `-- ${raw.length} bytes --`, hexDump(raw)].join("\n");
  fs.writeFileSync(path.join(capturesDir, `${base}.txt`), dump);
  console.log(`\n=== [${label}] captured ${raw.length} bytes -> captures/${base}.{bin,txt} ===`);
  console.log(dump);
}

function startTcpCapture(port: number): void {
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[tcp:${port}] connection from ${remote}`);

    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => {
      if (chunks.length === 0) {
        console.log(`[tcp:${port}] connection from ${remote} closed with no data`);
        return;
      }
      saveCapture(`tcp-${port}`, Buffer.concat(chunks), `Source: ${remote} (port ${port})`);
    });
    socket.on("error", (err) => console.error(`[tcp:${port}] socket error from ${remote}:`, err));
  });

  server.on("error", (err) => {
    console.warn(`[tcp:${port}] could not bind (${(err as NodeJS.ErrnoException).code ?? err}) — skipping this port`);
  });

  server.listen(port, () => {
    console.log(`[tcp:${port}] raw capture listener up`);
  });
}

function startHttpCapture(port: number): void {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const headerText = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      console.log(`[http:${port}] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
      saveCapture(`http-${port}`, body, `${req.method} ${req.url}\n${headerText}`);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(
        '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="true"/></s:Body></s:Envelope>'
      );
    });
  });

  server.on("error", (err) => {
    console.warn(`[http:${port}] could not bind (${(err as NodeJS.ErrnoException).code ?? err}) — skipping this port`);
  });

  server.listen(port, () => {
    console.log(`[http:${port}] raw capture listener up`);
  });
}

function startUdpCapture(port: number): void {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    console.log(`[udp:${port}] datagram from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
    saveCapture(`udp-${port}`, msg, `Source: ${rinfo.address}:${rinfo.port} (port ${port})`);
  });

  socket.on("error", (err) => {
    console.warn(`[udp:${port}] error (${(err as NodeJS.ErrnoException).code ?? err})`);
  });

  socket.bind(port, () => {
    socket.setBroadcast(true);
    console.log(`[udp:${port}] broadcast capture listener up`);
  });
}

for (const port of TCP_CAPTURE_PORTS) startTcpCapture(port);
for (const port of HTTP_CAPTURE_PORTS) startHttpCapture(port);
for (const port of UDP_CAPTURE_PORTS) startUdpCapture(port);

startMdns();

console.log(
  `\nStep 0 capture tool running. Point Square's printer profile at this machine's IP.\n` +
    `Watching TCP ports: ${TCP_CAPTURE_PORTS.join(", ")}\n` +
    `Watching HTTP ports: ${HTTP_CAPTURE_PORTS.join(", ")}\n` +
    `Watching UDP ports: ${UDP_CAPTURE_PORTS.join(", ")} (Star Micronics broadcast discovery)\n` +
    `Fire one test ticket / retry printer setup and inspect the captures/ directory + console.\n` +
    `If Square's "scan for printers" step finds nothing, watch the [mdns] logs above while\n` +
    `you retry the scan on the Square device — every query it sends will be logged here even\n` +
    `if we don't have a responder for it yet.\n`
);
