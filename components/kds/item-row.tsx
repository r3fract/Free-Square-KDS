import type { MouseEvent } from "react";
import type { OrderItemRow } from "@/lib/types";

export function ItemRow({
  item,
  completed,
  pending,
  onClick,
}: {
  item: OrderItemRow;
  completed: boolean;
  pending?: boolean;
  onClick?: () => void;
}) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // The whole order card is also tappable (to clear every item at once), so
    // stop the click here to avoid also triggering that card-level handler.
    event.stopPropagation();
    onClick?.();
  }

  return (
    <button
      type="button"
      onClick={onClick ? handleClick : undefined}
      disabled={!onClick}
      className={`flex min-h-16 w-full touch-manipulation select-none items-center justify-between gap-4 rounded-lg border px-4 py-4 text-left transition-colors ${
        onClick ? "" : "cursor-default"
      } ${pending ? "animate-pulse" : ""} ${
        completed
          ? "border-emerald-600 bg-emerald-50 active:bg-emerald-100 dark:bg-emerald-950 dark:active:bg-emerald-900"
          : "border-zinc-300 bg-white active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:active:bg-zinc-800"
      }`}
    >
      <span className="flex flex-col gap-0.5">
        <span
          className={`text-xl font-semibold ${
            completed
              ? "text-emerald-700 line-through dark:text-emerald-400"
              : "text-zinc-900 dark:text-zinc-50"
          }`}
        >
          {item.quantity}× {item.name}
          {item.variation_name ? ` — ${item.variation_name}` : ""}
        </span>
        {item.modifiers.length > 0 && (
          <span className="text-base text-zinc-500 dark:text-zinc-400">
            {item.modifiers.map((modifier) => modifier.name).join(", ")}
          </span>
        )}
        {item.note && (
          <span className="text-base italic text-zinc-500 dark:text-zinc-400">{item.note}</span>
        )}
        {pending && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Clearing… tap to undo
          </span>
        )}
      </span>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-lg font-bold ${
          completed
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-zinc-400 dark:border-zinc-600"
        }`}
      >
        {completed ? "✓" : ""}
      </span>
    </button>
  );
}
