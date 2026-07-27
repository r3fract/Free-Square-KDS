import type { ConnectionStatus } from "@/lib/use-orders-store";

const LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  disconnected: "Reconnecting…",
};

const DOT_CLASS: Record<ConnectionStatus, string> = {
  connecting: "bg-zinc-400",
  connected: "bg-emerald-500",
  disconnected: "bg-amber-500",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
      <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[status]}`} />
      {LABEL[status]}
    </div>
  );
}
