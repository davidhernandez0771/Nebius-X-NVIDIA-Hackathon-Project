// The cartridge being made on the bench, shared by the editor (the overlay) and the bench in 3D, and
// the stage the making is at: a blank shell picked off the bench (material), its colour, its robot,
// its name, done. Mutated in place through these functions; both hear about changes through
// `subscribeBench`.
import { draftArt, type LabelArt } from "../../scene/labels";
import { ROBOTS } from "../../scene/robots";
import { FINISHES, cleanColour, cleanName, finishOf, type Draft, type FinishId } from "../../scene/saved";

export const STAGES = ["material", "colour", "robot", "name", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const FRESH: Draft = { name: "", finish: null, color: FINISHES[0].color, robot: ROBOTS[0].code };

export const bench = {
  draft: { ...FRESH } as Draft,
  stage: "material" as Stage,
  /** The blank under the pointer on the bench (it lifts a little), or -1. */
  hover: -1,
  /** Goes up with every blank picked onto the turntable (the 3D flies it over). */
  picks: 0,
  /** The last label the printer printed, and a count that goes up with every print (the 3D restarts its slide on a change). */
  printed: null as LabelArt | null,
  prints: 0,
  /** Goes up with every change to the draft. */
  edits: 0,
  /** The saved place a cartridge is flying to from the turntable (the spiral keeps it hidden till it lands), or -1. */
  landing: -1,
  /** A count that goes up with every flight (the 3D starts the finish and the flight on a change). */
  flights: 0,
  /** When the last save was (performance.now()): the camera holds the close shot through the click. */
  savedAt: -Infinity,
};

const fns = new Set<() => void>();
export function subscribeBench(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
const notify = () => fns.forEach((fn) => fn());

export function setDraft(change: Partial<Draft>): void {
  const next = { ...bench.draft, ...change };
  // A colour that isn't #rrggbb keeps the one it had.
  next.color = cleanColour(next.color) ?? bench.draft.color;
  const d = bench.draft;
  if (next.name === d.name && next.finish === d.finish && next.color === d.color && next.robot === d.robot) return;
  bench.draft = next;
  bench.edits++;
  notify();
}

/** A blank picked off the bench: its finish, in the colour it came in. The 3D flies it to the turntable. */
export function pickFinish(id: FinishId): void {
  if (bench.draft.finish === id) return;
  bench.picks++;
  setDraft({ finish: id, color: finishOf(id).color });
}

/** Whether a stage has what it asks for: a shell picked, a name given. */
export function canAdvance(stage: Stage, d: Draft): boolean {
  if (stage === "material") return d.finish !== null;
  if (stage === "name") return cleanName(d.name) !== "";
  return stage !== "done";
}

export function setStage(stage: Stage): void {
  if (bench.stage === stage) return;
  bench.stage = stage;
  notify();
}

/** On to the next stage, if this one is answered. The name stage ends with the save, not here. */
export function nextStage(): boolean {
  const i = STAGES.indexOf(bench.stage);
  if (bench.stage === "name" || bench.stage === "done" || !canAdvance(bench.stage, bench.draft)) return false;
  setStage(STAGES[i + 1]);
  return true;
}

/** Back a stage (never before the first; a saved one stays done). */
export function prevStage(): boolean {
  const i = STAGES.indexOf(bench.stage);
  if (i <= 0 || bench.stage === "done") return false;
  setStage(STAGES[i - 1]);
  return true;
}

export function setHover(i: number): void {
  if (bench.hover === i) return;
  bench.hover = i;
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

/** A save: the finish plays, and the cartridge leaves the turntable for its place on the spiral. */
export function startFlight(place: number): void {
  bench.landing = place;
  bench.savedAt = typeof performance === "undefined" ? 0 : performance.now();
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

/** A fresh bench: no draft, nothing in the printer, back at the first stage. */
export function resetBench(): void {
  bench.draft = { ...FRESH };
  bench.stage = "material";
  bench.hover = -1;
  bench.printed = null;
  bench.edits = 0;
  bench.landing = -1;
  notify();
}

/** The next cartridge: a fresh draft at the first stage (the printer and a flight keep going). */
export function startAnother(): void {
  bench.draft = { ...FRESH };
  bench.stage = "material";
  bench.edits++;
  notify();
}
