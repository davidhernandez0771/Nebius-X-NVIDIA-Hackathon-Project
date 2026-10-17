// Browser-side control region for webcam teleop ("move less = move more").
//
// The palm center (mean of landmarks 0, 5, 9, 17) is remapped into the user's control region
// with SANT's mapping (hand/contracts.ts, "Control-region mapping", steps 1-2: remap the region
// onto [0,1], then clamp), and palm width into a near/far depth range. The result travels as
// HandPoseMsg.control = [u, v, depth], raw unmirrored like wrist_uv; the sim worker's
// to_ee_target() maps it straight onto the workspace, still doing the mirroring there.
//
// Same ControlRegion type as SANT's hand cursor, but its own settings and storage key: the
// cursor's region (sant.hand.controlRegion) and the teleop region are tuned independently.

import { DEFAULT_CONTROL_REGION, type ControlRegion, type HandLandmark } from "../hand/contracts";

export const PALM_LANDMARKS = [0, 5, 9, 17] as const; // wrist, index MCP, middle MCP, pinky MCP
export const TELEOP_CONTROL_STORAGE_KEY = "pm.teleop.region";

export interface TeleopControlSettings {
  enabled: boolean; // false: no control field is sent, the sim uses wrist_uv as before
  region: ControlRegion;
  depthFar: number; // palm width (px / frame_w) with the hand far from the camera -> depth 0
  depthNear: number; // ... near the camera -> depth 1
  depthAuto: boolean; // true: re-center the depth range on the hand when tracking starts (ReachCenterer)
  invertX: boolean; // flips left-right
  invertY: boolean; // flips up-down
}

// SANT's default size (0.55), centered horizontally, lifted so the bottom edge sits at 0.70 of the
// frame: with the palm center there, the wrist is still around 0.8, so a relaxed and fully visible
// hand reaches table height instead of leaving the frame.
export const DEFAULT_TELEOP_REGION: ControlRegion = { ...DEFAULT_CONTROL_REGION, centerX: 0.5, centerY: 0.425 };

export const DEFAULT_TELEOP_CONTROL: TeleopControlSettings = {
  enabled: true,
  region: DEFAULT_TELEOP_REGION,
  depthFar: 0.07,
  depthNear: 0.13,
  depthAuto: true,
  invertX: false,
  invertY: false,
};

export const REGION_SIZE_MIN = 0.15;
export const REGION_SIZE_MAX = 0.9;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function palmCenter(lm: HandLandmark[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM_LANDMARKS) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / PALM_LANDMARKS.length, y: y / PALM_LANDMARKS.length };
}

/** SANT's steps 1-2: the point's place in the region, clamped to [0,1]. No mirroring. */
export function regionFraction(p: { x: number; y: number }, r: ControlRegion): [number, number] {
  const w = r.width || Number.EPSILON;
  const h = r.height || Number.EPSILON;
  const tX = (p.x - (r.centerX - w / 2)) / w;
  const tY = (p.y - (r.centerY - h / 2)) / h;
  return [clamp(tX, 0, 1), clamp(tY, 0, 1)];
}

/** 0 at depthFar, 1 at depthNear, clamped. On a log scale: palm width goes as 1 / distance, so equal
 *  ratios of palm width are equal steps of reach, and the geometric mean of far and near is 0.5. */
export function depthFraction(palmWidth: number, far: number, near: number): number {
  if (!(palmWidth > 0)) return 0;
  return clamp(Math.log(palmWidth / far) / (Math.log(near / far) || Number.EPSILON), 0, 1);
}

// Palm width jitters by a few percent frame to frame; unsmoothed, the arm would shake in and out.
// A time-based EMA (frame-rate independent): ~120 ms time constant, a lag a user doesn't feel.
export const DEPTH_SMOOTHING_MS = 120;

/** One EMA step from prev toward raw over dtMs; a clock that didn't advance holds prev. */
export function smoothDepth(raw: number, prev: number, dtMs: number): number {
  if (!(dtMs > 0)) return prev;
  return prev + (1 - Math.exp(-dtMs / DEPTH_SMOOTHING_MS)) * (raw - prev);
}

/** HandPoseMsg.control for one hand: [u, v, depth], raw orientation, with the user's inversions applied. */
export function toControl(lm: HandLandmark[], palmWidth: number, s: TeleopControlSettings): [number, number, number] {
  const [u, v] = regionFraction(palmCenter(lm), s.region);
  return [s.invertX ? 1 - u : u, s.invertY ? 1 - v : v, depthFraction(palmWidth, s.depthFar, s.depthNear)];
}

/** Keeps the region inside the frame and its size in range. */
export function clampRegion(r: ControlRegion): ControlRegion {
  const width = clamp(r.width, REGION_SIZE_MIN, REGION_SIZE_MAX);
  const height = clamp(r.height, REGION_SIZE_MIN, REGION_SIZE_MAX);
  return {
    centerX: clamp(r.centerX, width / 2, 1 - width / 2),
    centerY: clamp(r.centerY, height / 2, 1 - height / 2),
    width,
    height,
  };
}

/** Anything (e.g. stored JSON) -> valid settings; each bad field falls back to its default. */
export function sanitizeTeleopControl(raw: unknown): TeleopControlSettings {
  const d = DEFAULT_TELEOP_CONTROL;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const r = (o.region && typeof o.region === "object" ? o.region : {}) as Record<string, unknown>;
  const region = clampRegion({
    centerX: finite(r.centerX) ? r.centerX : d.region.centerX,
    centerY: finite(r.centerY) ? r.centerY : d.region.centerY,
    width: finite(r.width) ? r.width : d.region.width,
    height: finite(r.height) ? r.height : d.region.height,
  });
  const depthOk = finite(o.depthFar) && finite(o.depthNear) && 0 < o.depthFar && o.depthFar < o.depthNear && o.depthNear < 1;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    enabled: bool(o.enabled, d.enabled),
    region,
    depthFar: depthOk ? (o.depthFar as number) : d.depthFar,
    depthNear: depthOk ? (o.depthNear as number) : d.depthNear,
    depthAuto: bool(o.depthAuto, d.depthAuto),
    invertX: bool(o.invertX, d.invertX),
    invertY: bool(o.invertY, d.invertY),
  };
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function loadTeleopControl(store?: KeyValueStore): TeleopControlSettings {
  try {
    const raw = (store ?? localStorage).getItem(TELEOP_CONTROL_STORAGE_KEY);
    return raw ? sanitizeTeleopControl(JSON.parse(raw)) : DEFAULT_TELEOP_CONTROL;
  } catch {
    return DEFAULT_TELEOP_CONTROL;
  }
}

export function saveTeleopControl(s: TeleopControlSettings, store?: KeyValueStore): void {
  try {
    (store ?? localStorage).setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private browsing or storage disabled: the settings just won't persist.
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- Auto-centered reach: the hand's natural distance is the middle of the reach ------------

// Live test #2: a fixed depth range doesn't fit every webcam and seat (the user's palm read 0.059,
// below the 0.07 default far end), and depth clamped to 0 left the arm 20 cm short of the cube.
// So the range is centered on the hand's own natural palm width: depth 0.5 there, which to_ee_target
// maps to x 0.50, the cube's row; 30% closer or farther reaches the ends.
export const RECENTER_FACTOR = 1.3;
export const RECENTER_MS = 1000;
const RECENTER_MIN_SAMPLES = 5;

export function reachFromNeutral(neutral: number): { depthFar: number; depthNear: number } {
  return { depthFar: neutral / RECENTER_FACTOR, depthNear: neutral * RECENTER_FACTOR };
}

/** Collects ~1 s of tracked palm widths, then answers once with reachFromNeutral(median). */
export class ReachCenterer {
  private start: number | null = null;
  private widths: number[] = [];
  done = false;

  push(t: number, palmWidth: number | null): { depthFar: number; depthNear: number } | null {
    if (this.done || palmWidth === null || !(palmWidth > 0)) return null;
    if (this.start === null) this.start = t; // the clock starts when the hand is first seen
    this.widths.push(palmWidth);
    if (t - this.start < RECENTER_MS || this.widths.length < RECENTER_MIN_SAMPLES) return null;
    this.done = true;
    return reachFromNeutral(median(this.widths));
  }
}

// --- Calibrate by hand: comfortable movement, then a near hold and a far hold ---------------

export type CalibrationStep = "move" | "near" | "far" | "done" | "failed";

export interface CalibrationSample {
  t: number; // HandFrame.timestamp, ms
  center: { x: number; y: number } | null; // palm center, raw; null when no hand
  palmWidth: number;
}

export interface CalibrationResult {
  region: ControlRegion;
  depthFar: number;
  depthNear: number;
}

export interface CalibrationState {
  step: CalibrationStep;
  progress: number; // 0..1 within the current step
  result?: CalibrationResult;
  error?: string;
}

export interface CalibratorOptions {
  moveMs: number;
  holdMs: number;
  settleMs: number; // time to get into the near/far position before the hold is measured
}

export const CALIBRATOR_DEFAULTS: CalibratorOptions = { moveMs: 5000, holdMs: 1500, settleMs: 1500 };
const MIN_SAMPLES = 10;
// SANT's wizard pads the reach outward by 1.25 so the cursor has room past it. For the arm the
// lowest comfortable point must still reach the table, so the pad is small.
const PADDING_FACTOR = 1.05;
const MIN_DEPTH_RATIO = 1.15; // near must be at least this much wider than far
const DEPTH_INSET = 0.1; // pull both ends 10% inward, so they are reachable without straining

export class TeleopCalibrator {
  private step: CalibrationStep = "move";
  private stepStart: number | null = null;
  private centers: { x: number; y: number }[] = [];
  private widths: number[] = [];
  private region: ControlRegion | null = null;
  private near = 0;
  private state: CalibrationState = { step: "move", progress: 0 };

  constructor(private readonly opts: CalibratorOptions = CALIBRATOR_DEFAULTS) {}

  push(sample: CalibrationSample): CalibrationState {
    if (this.step === "done" || this.step === "failed") return this.state;
    // Each step's clock starts at its first sample, so a slow UI between steps costs nothing.
    if (this.stepStart === null) this.stepStart = sample.t;
    const elapsed = sample.t - this.stepStart;

    if (this.step === "move") {
      if (sample.center) this.centers.push(sample.center);
      if (elapsed < this.opts.moveMs) return this.set({ step: "move", progress: elapsed / this.opts.moveMs });
      if (this.centers.length < MIN_SAMPLES) return this.fail("Your hand wasn't seen. Keep it in view and try again.");
      this.region = this.deriveRegion();
      return this.next("near");
    }

    const total = this.opts.settleMs + this.opts.holdMs;
    if (sample.center && elapsed >= this.opts.settleMs) this.widths.push(sample.palmWidth);
    if (elapsed < total) return this.set({ step: this.step, progress: elapsed / total });
    if (this.widths.length < MIN_SAMPLES) return this.fail("Your hand wasn't seen during the hold. Try again.");
    const width = median(this.widths);
    if (this.step === "near") {
      this.near = width;
      return this.next("far");
    }
    const far = width;
    if (!(this.near > far * MIN_DEPTH_RATIO))
      return this.fail("Near and far were too similar. Bring your hand closer for near and further back for far.");
    const inset = DEPTH_INSET * (this.near - far);
    return this.set({
      step: "done",
      progress: 1,
      result: { region: this.region!, depthFar: far + inset, depthNear: this.near - inset },
    }, "done");
  }

  /** SANT's CalibrationWizard rule: uniform size from the larger half-span around centerX 0.5, centerY mid-reach. */
  private deriveRegion(): ControlRegion {
    const xs = this.centers.map((c) => c.x);
    const ys = this.centers.map((c) => c.y);
    const halfX = Math.max(Math.abs(Math.max(...xs) - 0.5), Math.abs(Math.min(...xs) - 0.5));
    const halfY = (Math.max(...ys) - Math.min(...ys)) / 2;
    const size = Math.max(halfX, halfY) * 2 * PADDING_FACTOR;
    return clampRegion({ centerX: 0.5, centerY: (Math.max(...ys) + Math.min(...ys)) / 2, width: size, height: size });
  }

  private next(step: CalibrationStep): CalibrationState {
    this.stepStart = null;
    this.widths = [];
    return this.set({ step, progress: 0 }, step);
  }

  private fail(error: string): CalibrationState {
    return this.set({ step: "failed", progress: 1, error }, "failed");
  }

  private set(state: CalibrationState, step: CalibrationStep = this.step): CalibrationState {
    this.step = step;
    this.state = state;
    return state;
  }
}
