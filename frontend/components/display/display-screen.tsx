"use client";

import { ConnectionBadge } from "@/components/shared/connection-badge";
import { useDisplayStore } from "@/lib/use-display-store";
import { InProgressColumn } from "./in-progress-column";
import { NowServingColumn } from "./now-serving-column";

export function DisplayScreen() {
  const { inProgress, nowServing, loading, error, retry, connectionStatus } = useDisplayStore();

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">Order Status</h1>
        <ConnectionBadge status={connectionStatus} />
      </header>

      {loading && inProgress.length === 0 && nowServing.length === 0 && (
        <p className="text-2xl text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {error && (
        <div className="flex items-center gap-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xl text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
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

      <div className="grid flex-1 grid-cols-1 gap-8 md:grid-cols-2">
        <InProgressColumn entries={inProgress} />
        <NowServingColumn entries={nowServing} />
      </div>
    </div>
  );
}
