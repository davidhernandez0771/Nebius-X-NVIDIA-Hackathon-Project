// The cartridge being made on the bench, shared by the editor (the overlay) and the bench in 3D.
// Mutated in place through these functions; both hear about changes through `subscribeBench`.
import { draftArt, type LabelArt } from "../../scene/labels";
import { ROBOTS } from "../../scene/robots";
import type { Draft } from "../../scene/saved";

export const FRESH: Draft = { name: "", shell: "graphite", robot: ROBOTS[0].code };

export const bench = {
  draft: { ...FRESH } as Draft,
  /** The last label the printer printed, and a count that goes up with every print (the 3D restarts its slide on a change). */
  printed: null as LabelArt | null,
  prints: 0,
  /** Goes up with every change to the draft (the 3D cartridge gives a little turn). */
  edits: 0,
};

const fns = new Set<() => void>();
export function subscribeBench(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
const notify = () => fns.forEach((fn) => fn());

export function setDraft(change: Partial<Draft>): void {
  const next = { ...bench.draft, ...change };
  if (next.name === bench.draft.name && next.shell === bench.draft.shell && next.robot === bench.draft.robot) return;
  bench.draft = next;
  bench.edits++;
  notify();
}

/** The printer prints a saved cartridge's label (it slides out on the bench). */
export function printLabel(art: LabelArt): void {
  bench.printed = art;
  bench.prints++;
  notify();
}

/** Leaving the bench takes the printed label away. */
export function clearPrinter(): void {
  if (!bench.printed) return;
  bench.printed = null;
  notify();
}

/** What the bench's cartridge prints now. */
export const draftLabel = () => draftArt(bench.draft);

/** A fresh bench: no draft, nothing in the printer. */
export function resetBench(): void {
  bench.draft = { ...FRESH };
  bench.printed = null;
  bench.edits = 0;
  notify();
}
