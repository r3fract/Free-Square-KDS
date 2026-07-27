import type { DisplayInProgressEntry } from "@/lib/types";

export function InProgressColumn({ entries }: { entries: DisplayInProgressEntry[] }) {
  return (
    <section className="flex flex-1 flex-col gap-4">
      <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">In Progress</h2>
      {entries.length === 0 ? (
        <p className="text-2xl text-zinc-400 dark:text-zinc-500">No orders in progress.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-5 text-4xl font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
            >
              {entry.displayNumber ?? `#${entry.id}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
