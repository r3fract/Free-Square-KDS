import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "./env";

export type SocketRole = "kds" | "display";

export function createRoleSocket(role: SocketRole): Socket {
  const socket = io(SOCKET_URL, {
    autoConnect: true,
  });

  // The server does not persist room membership across a disconnect, so the
  // join must be re-sent on every connect, including automatic reconnects.
  socket.on("connect", () => {
    socket.emit("join", { role });
  });

  return socket;
}
