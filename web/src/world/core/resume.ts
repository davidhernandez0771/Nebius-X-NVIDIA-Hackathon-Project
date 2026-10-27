// Where the journey is, kept for a reload (site-nav, 2026-10-26, the user): a reload in the story or the descent
// comes back to the same place on the rail instead of the top. Like placeHash.ts, a small pure rule WorldRoot
// applies; the spot lives in the tab's session storage, not the URL, because it changes with every wheel step
// (a hash would rewrite the address bar the whole way down). Kept as a share of the rail, so a reload at another
// window height lands at the same point of the story. Only a reload resumes: a new visit starts at the top, and a
// place in the URL or a return from a 2D page wins over it.
const KEY = "world.spot";

/** Keep the spot (scroll y on a rail `total` px long). Storage may throw (private mode): then nothing resumes. */
export function saveSpot(storage: Storage | undefined, y: number, total: number): void {
  if (!(total > 0)) return;
  try {
    storage?.setItem(KEY, JSON.stringify({ u: Math.min(1, Math.max(0, y / total)) }));
  } catch {
    /* blocked */
  }
}

/** The scroll y to resume at on a reload, or null (not a reload, nothing kept, unreadable). */
export function resumeSpot(storage: Storage | undefined, reload: boolean, total: number): number | null {
  if (!reload) return null;
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const u = (JSON.parse(raw) as { u?: unknown }).u;
    return typeof u === "number" && u > 0 && u <= 1 ? u * total : null;
  } catch {
    return null;
  }
}

/** Whether this page load is a reload (the Navigation Timing entry; absent in old browsers and tests: not one). */
export function isReload(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "reload";
  } catch {
    return false;
  }
}
