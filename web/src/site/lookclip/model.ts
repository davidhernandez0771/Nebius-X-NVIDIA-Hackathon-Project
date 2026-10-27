// The LOOK clip's data: the same scene played by two policies, as scripts/build_look_clip.py wrote it to
// web/public/look-clip (index.json, then runs/raw/<seed>.json and runs/v2/<seed>.json in the test track's run format).
// Pure: parsing, the shared clip clock and the words. Nothing here runs physics; every pose is one Isaac recorded.
import type { TrackRun } from "../testtrack/model";

export type SideId = "raw" | "v2";
export const SIDE_IDS: SideId[] = ["raw", "v2"];

/** counted: one of the headline's own runs; rerun: a traced re-run of a counted seed that ended as the counted run
 * did; illustrative: run for this picture on a seed the headline didn't count. */
export type Standing = "counted" | "rerun" | "illustrative";

export type Side = {
  title: string;
  what: string;
  checkpoint: string | null;
  headline: { successes: number; n: number; seeds: [number, number] };
};

export type PairRun = {
  file: string;
  success: boolean;
  reasons: string[];
  durationS: number | null;
  endedBy: string | null;
  standing: Standing;
};

export type Pair = { seed: number; raw: PairRun; v2: PairRun };

export type Clip = { built: string; caption: string; label: string; pick: string; sides: Record<SideId, Side>; pairs: Pair[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fail = (what: string): never => {
  throw new Error(`the LOOK clip's ${what} doesn't read`);
};
const obj = (v: unknown, what: string) => (v && typeof v === "object" ? (v as Record<string, unknown>) : fail(what));

function parseSide(v: unknown): Side {
  const s = obj(v, "side");
  const h = obj(s.headline, "headline");
  const seeds = Array.isArray(h.seeds) && h.seeds.length === 2 ? (h.seeds as [number, number]) : fail("headline seeds");
  return {
    title: String(s.title ?? ""),
    what: String(s.what ?? ""),
    checkpoint: typeof s.checkpoint === "string" ? s.checkpoint : null,
    headline: { successes: num(h.successes) ?? fail("headline"), n: num(h.n) ?? fail("headline"), seeds },
  };
}

function parsePairRun(v: unknown): PairRun {
  const r = obj(v, "run");
  const file = typeof r.file === "string" && /^runs\/(raw|v2)\/\d+\.json$/.test(r.file) ? r.file : fail("run file");
  const standing = r.standing === "counted" || r.standing === "rerun" || r.standing === "illustrative" ? r.standing : fail("standing");
  return {
    file,
    success: r.success === true,
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
    durationS: num(r.duration_s),
    endedBy: typeof r.ended_by === "string" ? r.ended_by : null,
    standing,
  };
}

export function parseClip(body: unknown): Clip {
  const b = obj(body, "index");
  const sides = obj(b.sides, "sides");
  const pairs = Array.isArray(b.pairs) ? b.pairs : fail("pairs");
  return {
    built: String(b.built ?? ""),
    caption: typeof b.caption === "string" && b.caption ? b.caption : fail("caption"),
    label: String(b.label ?? "Illustrative replay"),
    pick: String(b.pick ?? ""),
    sides: { raw: parseSide(sides.raw), v2: parseSide(sides.v2) },
    pairs: pairs.map((p) => {
      const o = obj(p, "pair");
      return { seed: num(o.seed) ?? fail("seed"), raw: parsePairRun(o.raw), v2: parsePairRun(o.v2) };
    }),
  };
}

// ---- the clip's clock ----

/** After the quicker run ends, the clip plays on this long (the slower robot still at it), then holds. */
export const TAIL_S = 2.5;
/** The last frame rests this long before the clip plays again. */
export const CLIP_HOLD_S = 2;

const len = (r: Pick<TrackRun, "nSteps" | "fps">) => r.nSteps / r.fps;

/** How long the clip plays: until the quicker run is done plus TAIL_S, never past the longer run. Both runs start
 * at t = 0 from the same pose, so one clock drives both. */
export function clipDuration(a: Pick<TrackRun, "nSteps" | "fps">, b: Pick<TrackRun, "nSteps" | "fps">): number {
  const [short, long] = [Math.min(len(a), len(b)), Math.max(len(a), len(b))];
  return Math.min(long, short + TAIL_S);
}

/** A run's step at clip time t (a run that already ended stays on its last step). */
export const clipStep = (t: number, r: Pick<TrackRun, "nSteps" | "fps">) => Math.max(0, Math.min(r.nSteps - 1, Math.floor(t * r.fps)));

/** Where the camera looks: the robot, both runs' bins, cubes and hand paths, so the two views frame alike. */
export function sharedFrame(a: TrackRun, b: TrackRun): [number, number, number][] {
  const pts: [number, number, number][] = [[0, 0, 0], [0, 0, 0.85]];
  for (const r of [a, b]) pts.push(r.bin.pos, ...(r.cubePos ?? []), ...(r.handPos ?? []));
  return pts;
}

// ---- the words ----

/** Did the fingers ever touch the cube (Isaac's contact sensor), or null if the run didn't record it. */
export const touchedCube = (r: Pick<TrackRun, "contacts">): boolean | null => (r.contacts ? r.contacts.gripperCube.length > 0 : null);

/** The closest the hand came to the cube over the run, in metres, or null without both paths. */
export function closestToCube(r: Pick<TrackRun, "handPos" | "cubePos">): number | null {
  if (!r.handPos || !r.cubePos) return null;
  let best = Infinity;
  for (let k = 0; k < Math.min(r.handPos.length, r.cubePos.length); k++) {
    const [a, b] = [r.handPos[k], r.cubePos[k]];
    best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return Number.isFinite(best) ? best : null;
}

export const headlineText = (s: Side) => `${s.headline.successes}/${s.headline.n}`;
export const seedRange = (s: Side) => `seeds ${s.headline.seeds[0]}–${s.headline.seeds[1]}`;

/** Where this run stands against the side's pre-registered count. */
export function standingText(standing: Standing, seed: number, side: Side): string {
  const count = `${headlineText(side)} (${seedRange(side)})`;
  if (standing === "counted") return `Seed ${seed} is one of the runs counted in its ${count}.`;
  if (standing === "rerun") return `A traced re-run of seed ${seed}, counted in its ${count}; it ended exactly as the counted run did.`;
  return `Run for this picture on seed ${seed}: not part of its ${count}.`;
}

/** The status line under a robot at clip time t. Before the quicker run ends, it says the robot is at it; once it
 * has, both robots' verdicts show (the slower one's is how its whole run ended, said as such). */
export function statusText(run: PairRun, full: Pick<TrackRun, "contacts" | "nSteps" | "fps" | "handPos" | "cubePos">, t: number, revealAt: number): string {
  const runS = full.nSteps / full.fps;
  if (t < Math.min(revealAt, runS)) return `Running · ${t.toFixed(1)} s`;
  if (run.success) return `✓ In the bin · ${(run.durationS ?? runS).toFixed(1)} s · verified by SANT`;
  const touched = touchedCube(full);
  const how = touched === false ? "never touched the cube" : run.reasons.includes("dropped") ? "dropped the cube" : "the cube missed the bin";
  const end = run.endedBy === "time_limit" ? ` · kept trying to the ${Math.round(run.durationS ?? runS)} s limit` : "";
  return `✕ Failed · ${how}${end}`;
}
