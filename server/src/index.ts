import { createServer } from "http";
import { config } from "./config/env";
import { createApp } from "./app";
import { initSockets } from "./sockets/io";
import { pool } from "./db/pool";

const app = createApp();
const httpServer = createServer(app);

initSockets(httpServer);

httpServer.listen(config.PORT, () => {
  console.log(`KDS backend listening on port ${config.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  httpServer.close(() => {
    pool
      .end()
      .catch((err) => console.error("Error closing database pool:", err))
      .finally(() => process.exit(0));
  });

  // Force-exit if connections (e.g. open sockets) keep the server from closing cleanly.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
