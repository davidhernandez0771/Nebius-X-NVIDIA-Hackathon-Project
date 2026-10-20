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
  /** The saved place a cartridge is flying to from the turntable (the spiral keeps it hidden till it lands), or -1. */
  landing: -1,
  /** A count that goes up with every flight (the 3D starts one on a change). */
  flights: 0,
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

/** A save: the cartridge leaves the turntable for its place on the spiral. */
export function startFlight(place: number): void {
  bench.landing = place;
  bench.flights++;
  notify();
}

/** It landed (or the bench closed under it): the spiral shows it. */
export function endFlight(): void {
  if (bench.landing < 0) return;
  bench.landing = -1;
  notify();
}

/** What the bench's cartridge prints now. */
export const draftLabel = () => draftArt(bench.draft);

/** A fresh bench: no draft, nothing in the printer. */
export function resetBench(): void {
  bench.draft = { ...FRESH };
  bench.printed = null;
  bench.edits = 0;
  bench.landing = -1;
  notify();
}
