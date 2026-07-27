import { config } from "./env";
import { startTcpListener } from "./tcp.listener";
import { startHttpListener } from "./http.listener";
import { startMdns } from "./mdns";
import { startStarDiscoveryResponder } from "./star.discovery.listener";
import { startStarStatusListener } from "./star.status.listener";

startTcpListener();
startHttpListener();
startMdns();
startStarDiscoveryResponder();
startStarStatusListener();

console.log(
  `\nprinter-sim running.\n` +
    `  Star discovery (UDP)  -> port 22222\n` +
    `  Star ASB status (TCP) -> port 9101\n` +
    `  ESC/POS (raw TCP)     -> port ${config.PRINTER_TCP_PORT}\n` +
    `  ePOS-Print (HTTP)     -> port ${config.PRINTER_HTTP_PORT}\n` +
    `  forwarding parsed tickets to ${config.KDS_SERVER_URL}/api/printer-tickets\n`
);
