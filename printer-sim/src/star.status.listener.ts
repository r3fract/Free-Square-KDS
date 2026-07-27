import * as net from "net";
import { buildStatusResponse, isStatusQuery } from "./star.protocol";
import { consumeCurrentAsbFrame } from "./star.state";

const STATUS_PORT = 9101;
// Real printers hold an idle (no-data) 9101 connection for exactly 5.0s before closing —
// see research/notes-9101-lifecycle.md cited in star.protocol.ts.
const IDLE_TIMEOUT_MS = 5000;

/** Answers Star's TCP:9101 ASB status poll-respond protocol: accept, wait for the 51-byte
 * query, reply with the (doubled) current status frame, close. Reports "ETB executed" for
 * exactly one poll after tcp.listener.ts sees a print job's ETB marker (via star.state.ts),
 * then reverts to idle — Square appears to hold a job as "queued/retrying" until it observes
 * that confirmation. */
export function startStarStatusListener(): net.Server {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[star-status] connection from ${remote}`);
    const idleTimer = setTimeout(() => {
      console.log(`[star-status] ${remote} idle for ${IDLE_TIMEOUT_MS}ms with no data, closing`);
      socket.end();
    }, IDLE_TIMEOUT_MS);

    socket.once("data", (data) => {
      clearTimeout(idleTimer);
      if (isStatusQuery(data)) {
        const frame = consumeCurrentAsbFrame();
        console.log(
          `[star-status] query from ${remote} (${data.length} bytes) -> responding etb_executed=${frame[2] === 0x02}`
        );
        socket.end(buildStatusResponse(frame));
      } else {
        console.log(`[star-status] non-query data from ${remote} (${data.length} bytes), closing without response`);
        socket.end();
      }
    });

    socket.on("error", (err) => {
      console.error(`[star-status] socket error from ${remote}:`, err);
      clearTimeout(idleTimer);
    });
    socket.on("close", () => clearTimeout(idleTimer));
  });

  server.on("error", (err) => console.error(`[star-status] server error:`, err));

  server.listen(STATUS_PORT, () => {
    console.log(`[star-status] ASB status responder listening on TCP ${STATUS_PORT}`);
  });

  return server;
}
