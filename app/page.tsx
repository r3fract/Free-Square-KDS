import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 bg-zinc-50 px-6 py-24 dark:bg-black">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">Kitchen Display System</h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
          Choose a screen to open.
        </p>
      </div>
      <div className="flex w-full max-w-xl flex-col gap-4 sm:flex-row">
        <Link
          href="/kds"
          className="flex flex-1 touch-manipulation select-none flex-col gap-1 rounded-xl border border-zinc-200 bg-white px-8 py-8 text-center shadow-sm transition-colors hover:border-zinc-400 active:border-zinc-500 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:active:border-zinc-500 dark:active:bg-zinc-800/50"
        >
          <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kitchen</span>
          <span className="text-base text-zinc-500 dark:text-zinc-400">Mark items complete</span>
        </Link>
        <Link
          href="/display"
          className="flex flex-1 touch-manipulation select-none flex-col gap-1 rounded-xl border border-zinc-200 bg-white px-8 py-8 text-center shadow-sm transition-colors hover:border-zinc-400 active:border-zinc-500 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:active:border-zinc-500 dark:active:bg-zinc-800/50"
        >
          <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Now Serving</span>
          <span className="text-base text-zinc-500 dark:text-zinc-400">Customer-facing board</span>
        </Link>
      </div>
    </div>
  );
}
