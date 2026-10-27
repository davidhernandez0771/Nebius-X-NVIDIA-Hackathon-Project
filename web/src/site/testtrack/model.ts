// The test track's data: simulations that already ran in Isaac, as scripts/build_test_track.py wrote them to
// web/public/test-track-data (index.json, then one runs/<source>/<seed>.json per replay). Pure: parsing, the playback
// clock, the keyboard map and the words on the tags. Nothing here runs physics; every pose is one Isaac recorded.
import { parseEpisode, type Episode } from "../../twin/replay";
import type { QuatWxyz, Vec3 } from "../../twin/types";

export type CubeSource = "recorded" | "estimated";

export type RunRow = {
  id: string;
  seed: number;
  /** A replay was saved (a failed distillation rollout saved none: it is listed, not played). */
  recorded: boolean;
  file: string | null;
  success: boolean;
  reasons: string[];
  durationS: number | null;
  pathM: number | null;
  peakContactN: number | null;
  settleS: number | null;
  /** The teacher's own verdict inside its training env (the gate runs), or null. */
  inEnv: boolean | null;
  cubeSource: CubeSource | null;
  endedBy: string | null;
  steps: number | null;
};

export type CubeEstimate = { episodes: number; heldMedianMm: number; heldP95Mm: number; landedMedianMm: number; landedMaxMm: number };

export type Source = {
  id: string;
  title: string;
  what: string;
  checkpoint: string | null;
  seeds: [number, number];
  summary: { successes: number; n: number; ci95: [number, number]; judge: string };
  /** A word on how the source was put together (the final test: where the bin comes from), or null. */
  note: string | null;
  runs: RunRow[];
  cubeEstimate: CubeEstimate | null;
};

export type TrackIndex = { built: string; sources: Source[] };

export type Facts = { success: boolean; reasons: string[]; durationS: number | null; pathM: number | null; peakContactN: number | null; settleS: number | null };

/** Step ranges [first, last + 1) where Isaac's contact sensors fired (the final test records them). */
export type Contacts = { gripperCube: [number, number][]; armBin: [number, number][]; armTable: [number, number][] };

/** handPos: the tool point Isaac recorded each step (the trail), or null. cubeQuats: the cube's recorded rotation each
 * step, or null where only its start orientation is known. contacts: the contact sensors, or null. */
export type TrackRun = Episode & {
  cubeSource: CubeSource;
  contactN: number[] | null;
  handPos: Vec3[] | null;
  cubeQuats: QuatWxyz[] | null;
  contacts: Contacts | null;
  facts: Facts;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const fail = (what: string): never => {
  throw new Error(`the test track's ${what} doesn't read`);
};

function parseRow(r: Record<string, unknown>): RunRow {
  const cube = r.cube_source === "recorded" || r.cube_source === "estimated" ? r.cube_source : null;
  return {
    id: String(r.id),
    seed: num(r.seed) ?? fail("seed"),
    recorded: r.recorded === true && typeof r.file === "string",
    file: typeof r.file === "string" ? r.file : null,
    success: r.success === true,
    reasons: strs(r.reasons),
    durationS: num(r.duration_s),
    pathM: num(r.path_m),
    peakContactN: num(r.peak_contact_n),
    settleS: num(r.settle_s),
    inEnv: typeof r.in_env === "boolean" ? r.in_env : null,
    cubeSource: cube,
    endedBy: typeof r.ended_by === "string" ? r.ended_by : null,
    steps: num(r.steps),
  };
}

function parseEstimate(e: unknown): CubeEstimate | null {
  const o = (e ?? null) as Record<string, unknown> | null;
  if (!o || !num(o.episodes)) return null;
  return {
    episodes: num(o.episodes)!,
    heldMedianMm: num(o.held_median_mm) ?? fail("cube estimate"),
    heldP95Mm: num(o.held_p95_mm) ?? fail("cube estimate"),
    landedMedianMm: num(o.landed_median_mm) ?? fail("cube estimate"),
    landedMaxMm: num(o.landed_max_mm) ?? fail("cube estimate"),
  };
}

export function parseIndex(body: unknown): TrackIndex {
  const b = (body ?? {}) as Record<string, unknown>;
  const sources = Array.isArray(b.sources) ? (b.sources as Record<string, unknown>[]) : fail("index");
  return {
    built: String(b.built ?? ""),
    sources: sources.map((s) => {
      const sum = (s.summary ?? {}) as Record<string, unknown>;
      const ci = Array.isArray(sum.ci95) && sum.ci95.length === 2 ? (sum.ci95 as [number, number]) : fail("interval");
      const seeds = Array.isArray(s.seeds) && s.seeds.length === 2 ? (s.seeds as [number, number]) : fail("seeds");
      return {
        id: String(s.id),
        title: String(s.title),
        what: String(s.what ?? ""),
        checkpoint: typeof s.checkpoint === "string" ? s.checkpoint : null,
        seeds,
        summary: { successes: num(sum.successes) ?? fail("summary"), n: num(sum.n) ?? fail("summary"), ci95: ci, judge: String(sum.judge ?? "") },
        note: typeof s.note === "string" && s.note ? s.note : null,
        runs: (Array.isArray(s.runs) ? (s.runs as Record<string, unknown>[]) : fail("runs")).map(parseRow),
        cubeEstimate: parseEstimate(s.cube_estimate),
      };
    }),
  };
}

function parseContacts(c: unknown): Contacts | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const spans = (v: unknown): [number, number][] =>
    Array.isArray(v) ? v.filter((s): s is [number, number] => Array.isArray(s) && s.length === 2 && s.every((x) => typeof x === "number")) : [];
  return { gripperCube: spans(o.gripper_cube), armBin: spans(o.arm_bin), armTable: spans(o.arm_table) };
}

export function parseRun(body: unknown): TrackRun {
  const ep = parseEpisode(body);
  const b = body as Record<string, unknown>;
  const f = (b.facts ?? {}) as Record<string, unknown>;
  const contact = Array.isArray(b.contact_n) && b.contact_n.length === ep.nSteps ? (b.contact_n as number[]) : null;
  const hand = Array.isArray(b.hand_pos) && b.hand_pos.length === ep.nSteps ? (b.hand_pos as Vec3[]) : null;
  const quats = Array.isArray(b.cube_quat_path) && b.cube_quat_path.length === ep.nSteps ? (b.cube_quat_path as QuatWxyz[]) : null;
  return {
    ...ep,
    cubeSource: b.cube_source === "estimated" ? "estimated" : "recorded",
    contactN: contact,
    handPos: hand,
    cubeQuats: quats,
    contacts: parseContacts(b.contacts),
    facts: {
      success: f.success === true,
      reasons: strs(f.reasons),
      durationS: num(f.duration_s),
      pathM: num(f.path_m),
      peakContactN: num(f.peak_contact_n),
      settleS: num(f.settle_s),
    },
  };
}

// ---- playback ----

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
/** After the last step the run rests this long, the cube where it landed, before it plays again. */
export const END_HOLD_S = 1.2;

export const runDuration = (run: Pick<Episode, "nSteps" | "fps">) => run.nSteps / run.fps;

/** The clock after dt seconds of wall time at `speed`; it loops over the run plus the hold. */
export function advance(t: number, dt: number, speed: number, duration: number, hold = END_HOLD_S): number {
  const loop = duration + hold;
  if (loop <= 0) return 0;
  return (t + Math.max(0, dt) * speed) % loop;
}

export const stepAt = (t: number, run: Pick<Episode, "nSteps" | "fps">) => Math.max(0, Math.min(run.nSteps - 1, Math.floor(t * run.fps)));

export function nextSpeed(speed: number, dir: 1 | -1): number {
  const i = SPEEDS.findIndex((s) => s >= speed);
  const at = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + dir))];
}

/** Which runs the grid shows: all of them, the verified ones or the failed ones. */
export type Show = "all" | "ok" | "failed";
export const SHOWS: Show[] = ["all", "ok", "failed"];
export const parseShow = (v: string | null): Show => (v === "ok" || v === "failed" ? v : "all");

export const shownRuns = (runs: RunRow[], show: Show): RunRow[] =>
  show === "all" ? runs : runs.filter((r) => (show === "ok" ? r.success : !r.success));

/** The next (or previous) replayable run, wrapping round; the same id when there is no other. */
export function neighbourRun(runs: RunRow[], id: string, dir: 1 | -1): string {
  const played = runs.filter((r) => r.recorded);
  if (played.length === 0) return id;
  const i = played.findIndex((r) => r.id === id);
  if (i < 0) return played[dir > 0 ? 0 : played.length - 1].id;
  return played[(i + dir + played.length) % played.length].id;
}

// ---- keyboard ----

export type KeyAction =
  | { type: "toggle" }
  | { type: "step"; by: number }
  | { type: "speed"; dir: 1 | -1 }
  | { type: "run"; dir: 1 | -1 }
  | { type: "source"; index: number }
  | { type: "resetView" }
  | { type: "trails" }
  | { type: "help" }
  | { type: "close" };

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Space", what: "Play or pause" },
  { keys: "← →", what: "One step back or on (Shift: ten)" },
  { keys: "[ ]", what: "Slower or faster" },
  { keys: "J K", what: "Previous or next run" },
  { keys: "1–4", what: "Pick a source" },
  { keys: "R", what: "Reset the camera" },
  { keys: "T", what: "Show or hide the paths" },
  { keys: "?", what: "These shortcuts" },
];

/** What a key press does, or null. Keys typed into a field, or with Ctrl, Alt or Meta, do nothing here. */
export function keyAction(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: EventTarget | null }): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el?.isContentEditable) {
    // the scrubber keeps its own arrows; Escape still closes
    return e.key === "Escape" ? { type: "close" } : null;
  }
  switch (e.key) {
    case " ":
      return tag === "BUTTON" || tag === "A" ? null : { type: "toggle" }; // Space on a button presses the button
    case "ArrowLeft":
      return { type: "step", by: e.shiftKey ? -10 : -1 };
    case "ArrowRight":
      return { type: "step", by: e.shiftKey ? 10 : 1 };
    case "[":
      return { type: "speed", dir: -1 };
    case "]":
      return { type: "speed", dir: 1 };
    case "j":
    case "J":
      return { type: "run", dir: -1 };
    case "k":
    case "K":
      return { type: "run", dir: 1 };
    case "t":
    case "T":
      return { type: "trails" };
    case "r":
    case "R":
      return { type: "resetView" };
    case "?":
      return { type: "help" };
    case "Escape":
      return { type: "close" };
    default:
      return /^[1-9]$/.test(e.key) ? { type: "source", index: Number(e.key) - 1 } : null;
  }
}

// ---- words ----

const REASONS: Record<string, string> = {
  dropped: "dropped the cube",
  collision: "pushed into the bin or the table",
  not_in_bin: "the cube missed the bin",
  gripper_closed: "never let go",
  not_settled: "the cube didn't settle",
  too_slow: "too slow",
  high_release: "let go too high",
  unreachable: "out of reach",
};

export function reasonText(reasons: string[], endedBy: string | null = null): string {
  const words = reasons.map((r) => REASONS[r] ?? r.replace(/_/g, " "));
  if (endedBy === "time_limit") words.push("stopped at the time limit");
  return words.join(", ") || "no reason recorded";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function summaryText(s: Source): string {
  const { successes: k, n, ci95, judge } = s.summary;
  return `${k}/${n} verified by ${judge} · Wilson 95% ${pct(ci95[0])}–${pct(ci95[1])}`;
}

export const seedsText = (s: Source) => `seeds ${s.seeds[0]}–${s.seeds[1]}`;

/** The run's key facts, as the holo tags show them. */
export function factTags(f: Facts, cube: CubeSource | null): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (f.durationS !== null) out.push({ label: "Time", value: `${f.durationS.toFixed(2)} s` });
  if (f.peakContactN !== null) out.push({ label: "Peak arm contact", value: `${f.peakContactN.toFixed(1)} N` });
  if (f.pathM !== null) out.push({ label: "Hand path", value: `${f.pathM.toFixed(2)} m` });
  if (f.settleS !== null) out.push({ label: "Cube settled in", value: `${f.settleS.toFixed(2)} s` });
  if (cube) out.push({ label: "Cube path", value: cube === "recorded" ? "recorded by Isaac" : "estimated from the gripper" });
  return out;
}

export function verdictText(f: Pick<Facts, "success" | "reasons">, endedBy: string | null = null): string {
  return f.success ? "In the bin · verified" : `Failed · ${reasonText(f.reasons, endedBy)}`;
}

export const estimateText = (e: CubeEstimate) =>
  `This run didn't record the cube, so it is drawn from the gripper. On ${e.episodes} runs that recorded both, that estimate was off by ${(e.heldMedianMm / 10).toFixed(1)} cm (median) while carried and ${(e.landedMedianMm / 10).toFixed(1)} cm where it landed.`;

const TOUCHES: [keyof Contacts, string][] = [
  ["gripperCube", "gripper on the cube"],
  ["armBin", "arm on the bin"],
  ["armTable", "arm on the table"],
];

/** What Isaac's contact sensors felt at a step, in words; null if the run didn't record them. */
export function contactsAt(run: Pick<TrackRun, "contacts" | "nSteps">, step: number): string[] | null {
  if (!run.contacts) return null;
  const k = Math.max(0, Math.min(run.nSteps - 1, step));
  return TOUCHES.filter(([key]) => run.contacts![key].some(([a, b]) => k >= a && k < b)).map(([, words]) => words);
}

/** The contact force at a step, if the run recorded it. */
export const contactAt = (run: TrackRun, step: number): number | null => (run.contactN ? run.contactN[Math.max(0, Math.min(run.nSteps - 1, step))] : null);
