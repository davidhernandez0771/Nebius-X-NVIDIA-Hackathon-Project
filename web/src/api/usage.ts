import { useSyncExternalStore } from "react";

// Nebius spend for the top-bar pill.
//
// TODO(backend): the backend logs usage (nebius_llm.usage.total_spend) but does
// not expose it over HTTP yet. When a route such as GET /api/usage exists,
// replace the session counter below with a fetch of its `est_cost_usd`.
// Until then the pill shows what this browser session has spent, summed from the
// `est_cost_usd` field the existing endpoints (analyze, organize, chat) return.
export const BUDGET_USD = 25;

const KEY = "sant.session-spend-usd";
const listeners = new Set<() => void>();

function read(): number {
  try {
    const v = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

let spent = read();

export function recordSpend(usd: number | undefined) {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
  spent += usd;
  try {
    sessionStorage.setItem(KEY, String(spent));
  } catch {
    /* storage unavailable: keep the in-memory total */
  }
  listeners.forEach((l) => l());
}

export function useSessionSpend(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => spent,
  );
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
