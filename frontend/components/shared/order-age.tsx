"use client";

import { useEffect, useState } from "react";

const TICK_MS = 30_000;
const WARN_MINUTES = 5;
const LATE_MINUTES = 10;

function formatAge(minutes: number): string {
  if (minutes < 1) return "just now";
  return `${minutes}m`;
}

function colorClass(minutes: number): string {
  if (minutes >= LATE_MINUTES) return "bg-red-600 text-white";
  if (minutes >= WARN_MINUTES) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function OrderAge({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));

  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${colorClass(minutes)}`}>
      {formatAge(minutes)}
    </span>
  );
}
