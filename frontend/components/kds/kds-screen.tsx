"use client";

import { useState } from "react";
import { ConnectionBadge } from "@/components/shared/connection-badge";
import { useOrdersStore } from "@/lib/use-orders-store";
import { OrderCard } from "./order-card";

type Tab = "active" | "completed";

export function KdsScreen() {
  const {
    orders,
    completedOrders,
    loading,
    error,
    retry,
    connectionStatus,
    completeItem,
    recallOrder,
  } = useOrdersStore();
  const [tab, setTab] = useState<Tab>("active");
  const [recallingId, setRecallingId] = useState<number | null>(null);

  async function handleRecall(orderId: number) {
    setRecallingId(orderId);
    try {
      await recallOrder(orderId);
    } finally {
      setRecallingId(null);
    }
  }

  const visibleOrders = tab === "active" ? orders : completedOrders;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Kitchen</h1>
        <ConnectionBadge status={connectionStatus} />
      </header>

      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`flex min-h-12 touch-manipulation select-none items-center justify-center px-4 py-2 text-lg font-semibold transition-colors active:bg-zinc-100 dark:active:bg-zinc-800/60 ${
            tab === "active"
              ? "border-b-2 border-emerald-600 text-zinc-900 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Active ({orders.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("completed")}
          className={`flex min-h-12 touch-manipulation select-none items-center justify-center px-4 py-2 text-lg font-semibold transition-colors active:bg-zinc-100 dark:active:bg-zinc-800/60 ${
            tab === "completed"
              ? "border-b-2 border-emerald-600 text-zinc-900 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Completed ({completedOrders.length})
        </button>
      </div>

      {loading && visibleOrders.length === 0 && (
        <p className="text-lg text-zinc-500 dark:text-zinc-400">Loading orders…</p>
      )}

      {error && (
        <div className="flex items-center gap-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-12 touch-manipulation select-none items-center justify-center rounded-md border border-red-400 px-4 py-2 text-base font-semibold transition-colors hover:bg-red-100 active:bg-red-200 dark:hover:bg-red-900 dark:active:bg-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && visibleOrders.length === 0 && (
        <p className="text-lg text-zinc-500 dark:text-zinc-400">
          {tab === "active" ? "No active orders." : "No completed orders."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleOrders.map((order) =>
          tab === "active" ? (
            <OrderCard
              key={order.id}
              order={order}
              onToggleItem={(itemId, completed) => completeItem(order.id, itemId, completed)}
            />
          ) : (
            <OrderCard
              key={order.id}
              order={order}
              onRecall={() => handleRecall(order.id)}
              recalling={recallingId === order.id}
            />
          ),
        )}
      </div>
    </div>
  );
}
