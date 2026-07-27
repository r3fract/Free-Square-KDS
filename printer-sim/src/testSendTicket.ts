/**
 * Standalone verification script — no live Square/printer/KDS-Postgres needed.
 *
 * Spins up a mock "KDS server" (just captures whatever gets POSTed to /api/printer-tickets),
 * points KDS_SERVER_URL at it, starts the real ESC/POS + ePOS-Print listeners on ephemeral
 * ports, sends one canned ticket over each protocol, and asserts the mock KDS received two
 * correctly-parsed tickets. Exits non-zero on any mismatch.
 */
import * as http from "http";
import * as net from "net";

interface CapturedTicket {
  displayNumber: string | null;
  items: { name: string; quantity: string; modifiers: string[]; note: string | null }[];
}

function buildCannedEscPosTicket(): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x1b, 0x40])); // ESC @ — initialize
  const text = "Order #482\n2x Cheeseburger\n  No onion\n1x Fries\n";
  parts.push(Buffer.from(text, "latin1"));
  parts.push(Buffer.from([0x1d, 0x56, 0x00])); // GS V 0 — full cut (job boundary)
  return Buffer.concat(parts);
}

function buildCannedEposXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    "<s:Body>",
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    "<text>Ticket #217</text><feed/>",
    "<text>2x Cheeseburger</text><feed/>",
    "<text>  No onion</text><feed/>",
    "<text>1x Fries</text><feed/>",
    "<cut/>",
    "</epos-print>",
    "</s:Body>",
    "</s:Envelope>",
  ].join("\n");
}

function sendOverTcp(port: number, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.end(buffer);
    });
    socket.on("close", () => resolve());
    socket.on("error", reject);
  });
}

async function sendOverHttp(port: number, body: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/cgi-bin/epos/service.cgi`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body,
  });
  if (!res.ok) throw new Error(`mock printer HTTP listener returned ${res.status}`);
}

function assertTicket(label: string, ticket: CapturedTicket | undefined): void {
  if (!ticket) throw new Error(`${label}: no ticket captured`);
  if (ticket.displayNumber !== "482" && ticket.displayNumber !== "217") {
    throw new Error(`${label}: unexpected displayNumber ${JSON.stringify(ticket.displayNumber)}`);
  }
  if (ticket.items.length !== 2) {
    throw new Error(`${label}: expected 2 items, got ${ticket.items.length}`);
  }
  const [burger, fries] = ticket.items;
  if (burger.name !== "Cheeseburger" || burger.quantity !== "2" || !burger.modifiers.includes("No onion")) {
    throw new Error(`${label}: cheeseburger line parsed incorrectly: ${JSON.stringify(burger)}`);
  }
  if (fries.name !== "Fries" || fries.quantity !== "1") {
    throw new Error(`${label}: fries line parsed incorrectly: ${JSON.stringify(fries)}`);
  }
  console.log(`PASS [${label}]: displayNumber=${ticket.displayNumber}, items=${JSON.stringify(ticket.items)}`);
}

async function main(): Promise<void> {
  const received: CapturedTicket[] = [];

  const mockKds = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        console.error("[mockKds] failed to parse posted body:", err);
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ order: { id: received.length } }));
    });
  });
  await new Promise<void>((resolve) => mockKds.listen(0, "127.0.0.1", resolve));
  const mockPort = (mockKds.address() as net.AddressInfo).port;

  // Must be set before tcp.listener.ts/http.listener.ts (and their kdsClient import) load.
  process.env.KDS_SERVER_URL = `http://127.0.0.1:${mockPort}`;
  process.env.PRINTER_TCP_PORT = "0";
  process.env.PRINTER_HTTP_PORT = "0";

  const { startTcpListener } = await import("./tcp.listener");
  const { startHttpListener } = await import("./http.listener");

  const tcpServer = startTcpListener();
  const httpServer = startHttpListener();
  // Simpler and more robust than racing the 'listening' event (which may have already
  // fired by the time a listener attached after the synchronous listen() call runs, on
  // some platforms/loaders) — just give both servers a moment to finish binding.
  await new Promise((resolve) => setTimeout(resolve, 200));

  const tcpPort = (tcpServer.address() as net.AddressInfo).port;
  const httpPort = (httpServer.address() as net.AddressInfo).port;
  console.log(`[test] listening: tcp=${tcpPort} http=${httpPort} mockKds=${mockPort}`);

  console.log("[test] sending ESC/POS over TCP...");
  await sendOverTcp(tcpPort, buildCannedEscPosTicket());
  console.log("[test] ESC/POS TCP send complete");

  console.log("[test] sending ePOS-Print XML over HTTP...");
  await sendOverHttp(httpPort, buildCannedEposXml());
  console.log("[test] ePOS-Print HTTP send complete");

  // sendTicketToKds() is fire-and-forget from the listeners' perspective; give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("[test] wait complete, closing servers");

  tcpServer.close();
  httpServer.close();
  mockKds.close();

  console.log(`\nMock KDS received ${received.length} ticket(s).`);

  if (received.length !== 2) {
    throw new Error(`expected 2 tickets total (1 ESC/POS + 1 ePOS-XML), got ${received.length}`);
  }

  const escposTicket = received.find((t) => t.displayNumber === "482");
  const xmlTicket = received.find((t) => t.displayNumber === "217");
  assertTicket("ESC/POS over TCP", escposTicket);
  assertTicket("ePOS-Print XML over HTTP", xmlTicket);

  console.log("\nALL PASS");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
