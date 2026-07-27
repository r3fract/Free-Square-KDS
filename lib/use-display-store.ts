"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { api } from "./api";
import { createRoleSocket } from "./socket";
import type {
  DisplayInProgressEntry,
  DisplayNowServingEntry,
  DisplaySummary,
  OrderCompletedPayload,
  OrderWithItems,
} from "./types";

const POLL_INTERVAL_MS = 45_000;

interface DisplayState {
  inProgress: DisplayInProgressEntry[];
  nowServing: DisplayNowServingEntry[];
}

type Action =
  | { type: "hydrate"; summary: DisplaySummary }
  | { type: "orderUpserted"; order: OrderWithItems }
  | { type: "orderCompleted"; payload: OrderCompletedPayload };

function withoutId<T extends { id: number }>(list: T[], id: number): T[] {
  return list.filter((entry) => entry.id !== id);
}

function reducer(state: DisplayState, action: Action): DisplayState {
  switch (action.type) {
    case "hydrate":
      return { inProgress: action.summary.inProgress, nowServing: action.summary.nowServing };
    case "orderUpserted": {
      const { order } = action;
      if (order.state === "IN_PROGRESS") {
        return {
          inProgress: [
            ...withoutId(state.inProgress, order.id),
            { id: order.id, displayNumber: order.display_number, createdAt: order.created_at },
          ],
          nowServing: withoutId(state.nowServing, order.id),
        };
      }
      if (order.state === "COMPLETED") {
        return {
          inProgress: withoutId(state.inProgress, order.id),
          nowServing: [
            ...withoutId(state.nowServing, order.id),
            { id: order.id, displayNumber: order.display_number, readyAt: order.ready_at },
          ],
        };
      }
      return {
        inProgress: withoutId(state.inProgress, order.id),
        nowServing: withoutId(state.nowServing, order.id),
      };
    }
    case "orderCompleted": {
      const { orderId, displayNumber, readyAt } = action.payload;
      return {
        inProgress: withoutId(state.inProgress, orderId),
        nowServing: [...withoutId(state.nowServing, orderId), { id: orderId, displayNumber, readyAt }],
      };
    }
  }
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useDisplayStore() {
  const [state, dispatch] = useReducer(reducer, { inProgress: [], nowServing: [] });
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
        const summary = await api.getDisplaySummary();
        if (!cancelled) dispatch({ type: "hydrate", summary });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();

    const socket = createRoleSocket("display");

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
    socket.on("order:completed", (payload: OrderCompletedPayload) => {
      dispatch({ type: "orderCompleted", payload });
    });

    // The 15-minute "now serving" window has no expiry event, so periodically
    // re-fetch the summary purely to prune entries that have aged out.
    const pollId = setInterval(hydrate, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      socket.disconnect();
    };
  }, [reloadToken]);

  const inProgress = [...state.inProgress].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const nowServing = [...state.nowServing].sort(
    (a, b) => new Date(b.readyAt ?? 0).getTime() - new Date(a.readyAt ?? 0).getTime(),
  );

  return { inProgress, nowServing, loading, error, retry, connectionStatus };
}
