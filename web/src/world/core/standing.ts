// Which scenes stand: their files arrived and React mounted them (past their Suspense). The in-place
// "loading" state (ui/Wait.tsx) waits for both, so it never lifts onto a scene still being built.
// "intro:places" is the forest and the reactor, mounted inside the intro's scene.
const standing = new Set<string>();
const fns = new Set<() => void>();

export function markStanding(id: string): void {
  if (standing.has(id)) return;
  standing.add(id);
  fns.forEach((fn) => fn());
}

export const isStanding = (id: string): boolean => standing.has(id);

export function subscribeStanding(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

/** For tests: nothing stands. */
export function resetStanding(): void {
  standing.clear();
}
