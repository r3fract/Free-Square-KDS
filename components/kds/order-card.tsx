"use client";

import { useEffect, useRef, useState } from "react";
import { OrderAge } from "@/components/shared/order-age";
import type { OrderWithItems } from "@/lib/types";
import { ItemRow } from "./item-row";

const CLEAR_DELAY_MS = 3000;

export function OrderCard({
  order,
  onToggleItem,
  onRecall,
  recalling,
}: {
  order: OrderWithItems;
  onToggleItem?: (itemId: number, completed: boolean) => Promise<void>;
  onRecall?: () => Promise<void>;
  recalling?: boolean;
}) {
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  // If an item's completion changes from elsewhere (another station, a sync),
  // drop any local pending-clear for it so we don't double-fire or get stuck.
  useEffect(() => {
    setPendingIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        const item = order.items.find((i) => i.id === id);
        if (!item || item.completed) {
          next.delete(id);
          changed = true;
          const timeoutId = timeoutsRef.current.get(id);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutsRef.current.delete(id);
          }
        }
      }
      return changed ? next : prev;
    });
  }, [order.items]);

  function scheduleClear(itemIds: number[]) {
    if (itemIds.length === 0) return;
    setPendingIds((prev) => {
      const next = new Set(prev);
      itemIds.forEach((id) => next.add(id));
      return next;
    });
    itemIds.forEach((id) => {
      const timeoutId = setTimeout(() => {
        timeoutsRef.current.delete(id);
        setPendingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        onToggleItem?.(id, true);
      }, CLEAR_DELAY_MS);
      timeoutsRef.current.set(id, timeoutId);
    });
  }

  function cancelClear(itemId: number) {
    const timeoutId = timeoutsRef.current.get(itemId);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutsRef.current.delete(itemId);
    setPendingIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }

  function cancelAllPending() {
    timeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timeoutsRef.current.clear();
    setPendingIds(new Set());
  }

  function handleItemClick(itemId: number, completed: boolean) {
    if (pendingIds.has(itemId)) {
      cancelClear(itemId);
      return;
    }
    if (completed) {
      onToggleItem?.(itemId, false);
      return;
    }
    scheduleClear([itemId]);
  }

  function handleHeaderClick() {
    if (!onToggleItem) return;
    if (pendingIds.size > 0) {
      cancelAllPending();
      return;
    }
    const incompleteIds = order.items.filter((item) => !item.completed).map((item) => item.id);
    scheduleClear(incompleteIds);
  }

  return (
    <div
      onClick={onToggleItem ? handleHeaderClick : undefined}
      title={onToggleItem ? "Tap to clear all items" : undefined}
      className={`flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/50 ${
        onToggleItem
          ? "touch-manipulation select-none hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800/40 dark:active:bg-zinc-800"
          : ""
      }`}
    >
      <div className="flex items-center justify-between rounded-lg">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {order.display_number ?? `#${order.id}`}
          </h2>
          {order.source === "printer" && (
            <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Printer
            </span>
          )}
        </div>
        {onRecall ? (
          <button
            type="button"
            onClick={onRecall}
            disabled={recalling}
            className="inline-flex min-h-12 touch-manipulation select-none items-center justify-center rounded-md border border-zinc-400 px-4 py-2 text-base font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
          >
            {recalling ? "Recalling…" : "Recall"}
          </button>
        ) : (
          <OrderAge createdAt={order.created_at} />
        )}
      </div>
      {order.pickup_at && (
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Pickup{" "}
          {new Date(order.pickup_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
      {order.note && (
        <p className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {order.note}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {order.items.map((item) => {
          const pending = pendingIds.has(item.id);
          return (
            <ItemRow
              key={item.id}
              item={item}
              completed={pending || item.completed}
              pending={pending}
              onClick={onToggleItem ? () => handleItemClick(item.id, item.completed) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
