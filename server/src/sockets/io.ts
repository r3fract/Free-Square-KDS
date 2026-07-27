import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import type { OrderWithItems } from "../orders/orders.types";
import { corsOrigin } from "../config/cors";

type Room = "kds" | "display";

let io: Server | null = null;

export function initSockets(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin },
  });

  io.on("connection", (socket: Socket) => {
    socket.on("join", (payload: { role?: Room }) => {
      if (payload?.role === "kds" || payload?.role === "display") {
        socket.join(payload.role);
      }
    });
  });

  return io;
}

function emitToRooms(rooms: Room[], event: string, payload: unknown): void {
  if (!io) {
    console.warn(`[sockets] Attempted to emit "${event}" before sockets were initialized`);
    return;
  }
  for (const room of rooms) {
    io.to(room).emit(event, payload);
  }
}

export function broadcastOrderCreated(order: OrderWithItems): void {
  emitToRooms(["kds", "display"], "order:created", { order });
}

export function broadcastOrderUpdated(order: OrderWithItems): void {
  emitToRooms(["kds", "display"], "order:updated", { order });
}

export function broadcastItemUpdated(payload: {
  orderId: number;
  itemId: number;
  completed: boolean;
  completedAt: string | null;
}): void {
  emitToRooms(["kds"], "item:updated", payload);
}

export function broadcastOrderCompleted(payload: {
  orderId: number;
  displayNumber: string | null;
  readyAt: string | null;
}): void {
  emitToRooms(["kds", "display"], "order:completed", payload);
}
