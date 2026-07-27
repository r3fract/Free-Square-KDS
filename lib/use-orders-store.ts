"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { api } from "./api";
import { createRoleSocket } from "./socket";
import type { ItemUpdatedPayload, OrderWithItems } from "./types";

const MAX_COMPLETED_ORDERS = 50;

type OrdersState = {
  active: Map<number, OrderWithItems>;
  completed: Map<number, OrderWithItems>;
};

type Action =
  | { type: "hydrate"; activeOrders: OrderWithItems[]; completedOrders: OrderWithItems[] }
  | { type: "orderUpserted"; order: OrderWithItems }
  | { type: "itemUpdated"; payload: ItemUpdatedPayload };

function trimCompleted(map: Map<number, OrderWithItems>): Map<number, OrderWithItems> {
  if (map.size <= MAX_COMPLETED_ORDERS) return map;
  const sorted = Array.from(map.values()).sort(
    (a, b) => new Date(b.ready_at ?? b.updated_at).getTime() - new Date(a.ready_at ?? a.updated_at).getTime(),
  );
  return new Map(sorted.slice(0, MAX_COMPLETED_ORDERS).map((order) => [order.id, order]));
}

function reducer(state: OrdersState, action: Action): OrdersState {
  switch (action.type) {
    case "hydrate": {
      const active = new Map<number, OrderWithItems>();
      for (const order of action.activeOrders) {
        if (order.state === "IN_PROGRESS") active.set(order.id, order);
      }
      const completed = new Map<number, OrderWithItems>();
      for (const order of action.completedOrders) {
        if (order.state === "COMPLETED") completed.set(order.id, order);
      }
      return { active, completed };
    }
    case "orderUpserted": {
      const active = new Map(state.active);
      let completed = new Map(state.completed);
      active.delete(action.order.id);
      completed.delete(action.order.id);
      if (action.order.state === "IN_PROGRESS") {
        active.set(action.order.id, action.order);
      } else if (action.order.state === "COMPLETED") {
        completed.set(action.order.id, action.order);
        completed = trimCompleted(completed);
      }
      return { active, completed };
    }
    case "itemUpdated": {
      const { orderId, itemId, completed: itemCompleted, completedAt } = action.payload;
      const mapKey = state.active.has(orderId) ? "active" : state.completed.has(orderId) ? "completed" : null;
      if (!mapKey) return state;
      const order = state[mapKey].get(orderId)!;
      const nextMap = new Map(state[mapKey]);
      nextMap.set(orderId, {
        ...order,
        items: order.items.map((item) =>
          item.id === itemId ? { ...item, completed: itemCompleted, completed_at: completedAt } : item,
        ),
      });
      return { ...state, [mapKey]: nextMap };
    }
  }
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useOrdersStore() {
  const [state, dispatch] = useReducer(reducer, {
    active: new Map<number, OrderWithItems>(),
    completed: new Map<number, OrderWithItems>(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      setLoading(true);
      setError(null);
      try {
        const [activeOrders, completedOrders] = await Promise.all([
          api.getActiveOrders(),
          api.getCompletedOrders(),
        ]);
        if (!cancelled) dispatch({ type: "hydrate", activeOrders, completedOrders });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();

    const socket = createRoleSocket("kds");

    socket.on("connect", () => {
      setConnectionStatus("connected");
      hydrate();
    });
    socket.on("disconnect", () => setConnectionStatus("disconnected"));
    socket.on("connect_error", () => setConnectionStatus("disconnected"));

    socket.on("order:created", ({ order }: { order: OrderWithItems }) => {
      dispatch({ type: "orderUpserted", order });
    });
    socket.on("order:updated", ({ order }: { order: OrderWithItems }) => {
      dispatch({ type: "orderUpserted", order });
    });
    socket.on("item:updated", (payload: ItemUpdatedPayload) => {
      dispatch({ type: "itemUpdated", payload });
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [reloadToken]);

  const completeItem = useCallback(async (orderId: number, itemId: number, completed: boolean) => {
    const order = await api.setItemCompletion(orderId, itemId, completed);
    dispatch({ type: "orderUpserted", order });
  }, []);

  const recallOrder = useCallback(async (orderId: number) => {
    const order = await api.recallOrder(orderId);
    dispatch({ type: "orderUpserted", order });
  }, []);

  const orders = Array.from(state.active.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const completedOrders = Array.from(state.completed.values()).sort(
    (a, b) => new Date(b.ready_at ?? b.updated_at).getTime() - new Date(a.ready_at ?? a.updated_at).getTime(),
  );

  return {
    orders,
    completedOrders,
    loading,
    error,
    retry,
    connectionStatus,
    completeItem,
    recallOrder,
  };
}
