// The loader's progress: the real steps of the first scene, no timer. The hero is built in code (the
// tesseract, the dust, the backdrop), so it fetches no files of its own; what it waits for is:
// - engine: the 3D chunk arrived and the WebGL context is up (the intro's Scene mounted);
// - fonts: the faces the hero's words and the loader set, each one as it loads;
// - build: the tesseract, its studio light and the dust made for the tier;
// - shaders: every program on screen compiled and linked, one by one (three/compileSafe.ts);
// - rooms: the later scenes whose files are already in (or arrive within a short grace) mounted one at a
//   time out of sight, then all compiled (core/rooms.ts), so no frame after the reveal stalls on a build;
// - frames: a few frames drawn at a steady frame time (frameGate), so the first scroll never hitches.
// The heavier stations' files stream in the background meanwhile (core/assets.ts); what hasn't arrived
// by the rooms step is built after the reveal, in idle time.
export const STEPS = {
  engine: { weight: 0.15, label: "Loading the 3D engine" },
  fonts: { weight: 0.1, label: "Loading the type" },
  build: { weight: 0.05, label: "Building the tesseract" },
  shaders: { weight: 0.3, label: "Compiling shaders" },
  rooms: { weight: 0.25, label: "Building the rooms" },
  frames: { weight: 0.15, label: "Warming up" },
} as const;
export type Step = keyof typeof STEPS;
const ORDER = Object.keys(STEPS) as Step[];

/** Steady frames the loader waits for. */
export const FRAMES = 3;
/** A frame is steady within this share of the trailing frames' median. */
const STEADY = 1 / 3;
/** After this many frames it lets go however they went (a device that never settles still gets in). */
const MAX_FRAMES = 12;

export interface Status {
  /** The step it is waiting for (null: done). */
  step: Step | null;
  label: string;
  /** Its count ("12 / 31"), or "". */
  detail: string;
}

export interface Load {
  /** A step's share done, 0–1. */
  set(step: Step, f: number): void;
  /** A step counted in parts: `n` of `total` done (its detail shows the count). */
  count(step: Step, n: number, total: number): void;
  /** 0–1 overall. Never goes back. */
  value(): number;
  status(): Status;
  /** Every step done, or let go early. */
  done(): boolean;
  /** Let go now at what it has (continue anyway). */
  release(): void;
  released(): boolean;
  subscribe(fn: (v: number) => void): () => void;
  reset(): void;
}

export function createLoad(): Load {
  const parts = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<Step, number>;
  const counts: Partial<Record<Step, [number, number]>> = {};
  const fns = new Set<(v: number) => void>();
  let shown = 0;
  let let_go = false;
  const notify = () => fns.forEach((fn) => fn(shown));
  const update = (step: Step, f: number) => {
    const v = Math.min(1, Math.max(0, f));
    if (v <= parts[step]) return false;
    parts[step] = v;
    const sum = ORDER.reduce((s, k) => s + STEPS[k].weight * parts[k], 0);
    shown = Math.max(shown, Math.min(1, sum));
    return true;
  };
  const allDone = () => ORDER.every((k) => parts[k] >= 1);
  return {
    set(step, f) {
      if (update(step, f)) notify();
    },
    count(step, n, total) {
      const before = counts[step];
      const next: [number, number] = [Math.max(n, before?.[0] ?? 0), total];
      const changedCount = !before || before[0] !== next[0] || before[1] !== next[1];
      counts[step] = next;
      const moved = update(step, total > 0 ? next[0] / total : 1);
      if (moved || changedCount) notify();
    },
    value: () => (allDone() ? 1 : shown),
    status() {
      const step = ORDER.find((k) => parts[k] < 1) ?? null;
      if (!step) return { step: null, label: "Ready", detail: "" };
      const c = counts[step];
      const detail = !c ? "" : step === "frames" ? `${c[0]} / ${c[1]} steady frames` : `${c[0]} / ${c[1]}`;
      return { step, label: STEPS[step].label, detail };
    },
    done: () => let_go || allDone(),
    release() {
      if (let_go) return;
      let_go = true;
      notify();
    },
    released: () => let_go,
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    reset() {
      ORDER.forEach((k) => (parts[k] = 0));
      ORDER.forEach((k) => delete counts[k]);
      shown = 0;
      let_go = false;
    },
  };
}

/** The page's one loader. */
export const load = createLoad();

/**
 * How many of the latest frames (their times in seconds, oldest first) are steady: within a third of the
 * median of the last FRAMES, counting back from the newest. A hitch breaks the run, so the count starts
 * again after it. Judged against itself, so a slow software renderer can be steady too. Done at FRAMES
 * steady, or after MAX_FRAMES frames whatever they were.
 */
export function frameGate(times: readonly number[]): { steady: number; done: boolean } {
  const last = times.slice(-FRAMES).sort((a, b) => a - b);
  const median = last[Math.floor(last.length / 2)];
  let steady = 0;
  for (let i = times.length - 1; i >= 0 && steady < FRAMES; i--) {
    if (Math.abs(times[i] - median) > median * STEADY) break;
    steady++;
  }
  return { steady, done: steady >= FRAMES || times.length >= MAX_FRAMES };
}
