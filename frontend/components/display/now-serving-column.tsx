import type { DisplayNowServingEntry } from "@/lib/types";

export function NowServingColumn({ entries }: { entries: DisplayNowServingEntry[] }) {
  return (
    <section className="flex flex-1 flex-col gap-4">
      <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Now Serving</h2>
      {entries.length === 0 ? (
        <p className="text-2xl text-zinc-400 dark:text-zinc-500">No orders ready yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-xl border-2 border-emerald-600 bg-emerald-50 px-6 py-5 text-5xl font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            >
              {entry.displayNumber ?? `#${entry.id}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
