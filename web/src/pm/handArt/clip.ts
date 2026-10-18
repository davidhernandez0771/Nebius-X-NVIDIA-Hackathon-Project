// Hand clips: a timed list of landmark frames, for the preview route and for tests.
// The preview plays syntheticClip() until someone loads a real recording made with
// ClipRecorder (same format).

import type { HandLandmark } from "../../hand/contracts";

export interface ClipFrame {
  /** ms since the clip's first frame. */
  t: number;
  /** 21 raw (unmirrored) landmarks, or null when no hand was tracked. */
  landmarks: HandLandmark[] | null;
  gripperClosed: boolean;
  /** Optional Record state, for replaying the hand-art events. */
  frozen?: boolean;
  recording?: boolean;
  resets?: number;
}

/** The optional Record state a frame can carry. */
export type ClipSignals = Pick<ClipFrame, "frozen" | "recording" | "resets">;

const signalsOf = (f: ClipSignals): ClipSignals => {
  const out: ClipSignals = {};
  if (typeof f.frozen === "boolean") out.frozen = f.frozen;
  if (typeof f.recording === "boolean") out.recording = f.recording;
  if (typeof f.resets === "number" && Number.isFinite(f.resets)) out.resets = f.resets;
  return out;
};

export interface HandClip {
  version: 1;
  /** Where the frames came from, e.g. "synthetic" or "webcam". */
  source: string;
  frames: ClipFrame[];
}

export interface ClipSample extends ClipSignals {
  landmarks: HandLandmark[] | null;
  gripperClosed: boolean;
}

export const clipDurationMs = (c: HandClip) => c.frames[c.frames.length - 1].t;

/** The hand at time tMs, looping. Landmarks are interpolated between two tracked frames. */
export function sampleClip(c: HandClip, tMs: number): ClipSample {
  const d = clipDurationMs(c);
  const t = d > 0 ? ((tMs % d) + d) % d : 0;
  let i = 0;
  while (i < c.frames.length - 2 && c.frames[i + 1].t <= t) i++;
  const f0 = c.frames[i];
  const f1 = c.frames[i + 1];
  if (!f0.landmarks || !f1.landmarks) return { landmarks: f0.landmarks, gripperClosed: f0.gripperClosed, ...signalsOf(f0) };
  const k = f1.t > f0.t ? Math.min(1, (t - f0.t) / (f1.t - f0.t)) : 0;
  const b = f1.landmarks;
  return {
    landmarks: f0.landmarks.map((p, j) => ({
      x: p.x + (b[j].x - p.x) * k,
      y: p.y + (b[j].y - p.y) * k,
      z: p.z + (b[j].z - p.z) * k,
    })),
    gripperClosed: f0.gripperClosed,
    ...signalsOf(f0),
  };
}

/** Validates untrusted JSON (a loaded file) as a clip. Throws with the reason. */
export function parseClip(raw: unknown): HandClip {
  const o = raw as { version?: unknown; source?: unknown; frames?: unknown };
  if (!o || typeof o !== "object" || !Array.isArray(o.frames)) throw new Error("A clip needs a frames list.");
  if (o.frames.length < 2) throw new Error("A clip needs at least 2 frames.");
  let prev = -Infinity;
  const frames = o.frames.map((f: unknown, i: number): ClipFrame => {
    const fr = f as { t?: unknown; landmarks?: unknown; gripperClosed?: unknown } & ClipSignals;
    if (typeof fr?.t !== "number" || !Number.isFinite(fr.t)) throw new Error(`Frame ${i} has no time t.`);
    if (fr.t <= prev) throw new Error(`Frame times must increase (frame ${i}).`);
    prev = fr.t;
    let landmarks: HandLandmark[] | null = null;
    if (fr.landmarks != null) {
      const ok =
        Array.isArray(fr.landmarks) &&
        fr.landmarks.length === 21 &&
        fr.landmarks.every((p: { x?: unknown; y?: unknown; z?: unknown }) =>
          [p?.x, p?.y, p?.z].every((v) => typeof v === "number" && Number.isFinite(v)),
        );
      if (!ok) throw new Error(`Frame ${i} must have 21 landmarks with x, y and z, or null.`);
      landmarks = (fr.landmarks as HandLandmark[]).map(({ x, y, z }) => ({ x, y, z }));
    }
    return { t: fr.t, landmarks, gripperClosed: fr.gripperClosed === true, ...signalsOf(fr) };
  });
  return { version: 1, source: typeof o.source === "string" ? o.source : "unknown", frames };
}

/** Collects live frames into a clip (e.g. from Record's tracker), for replay in the preview. */
export class ClipRecorder {
  private frames: ClipFrame[] = [];
  private t0: number | null = null;

  constructor(
    private readonly source: string,
    private readonly maxFrames = 30 * 60,
  ) {}

  get size() {
    return this.frames.length;
  }

  add(timestamp: number, landmarks: readonly HandLandmark[] | null, gripperClosed: boolean, signals: ClipSignals = {}) {
    if (this.frames.length >= this.maxFrames) return;
    this.t0 ??= timestamp;
    const t = timestamp - this.t0;
    if (this.frames.length && t <= this.frames[this.frames.length - 1].t) return;
    this.frames.push({
      t,
      landmarks: landmarks ? landmarks.map(({ x, y, z }) => ({ x, y, z })) : null,
      gripperClosed,
      ...signalsOf(signals),
    });
  }

  toClip(): HandClip {
    return { version: 1, source: this.source, frames: this.frames.map((f) => ({ ...f })) };
  }
}

// ---------------------------------------------------------------------------
// A synthetic hand: a simple kinematic model posed along a keyframed script.
// Not a recording. It exists so the preview and tests run without a webcam.

interface Pose {
  cx: number; // wrist position in the frame
  cy: number;
  size: number; // wrist to middle knuckle, as a fraction of frame height
  roll: number; // radians, in the image plane
  curl: number; // 0 open .. 1 fist (index to pinky)
  pinch: number; // 0 .. 1, thumb tip onto the index tip
  spread: number; // finger splay multiplier
  vee: number; // 0 .. 1, ring, pinky and thumb fold away: the victory sign (reset)
}

type V3 = [number, number, number];

const FRAME_ASPECT = 4 / 3;
const DEG = Math.PI / 180;

// Hand-local units: wrist at the origin, middle knuckle at (0, 1), palm facing the camera,
// thumb to -x, z toward the camera is negative (MediaPipe's convention).
const KNUCKLES: V3[] = [
  [-0.3, 0.92, 0], // index 5
  [-0.02, 1.0, 0], // middle 9
  [0.24, 0.93, 0], // ring 13
  [0.45, 0.8, 0], // pinky 17
];
const SEGMENTS = [
  [0.45, 0.27, 0.22],
  [0.5, 0.3, 0.24],
  [0.46, 0.28, 0.22],
  [0.36, 0.21, 0.19],
];
const SPLAY = [-9, 0, 8, 17].map((d) => d * DEG);
const BEND = [72, 98, 68].map((d) => d * DEG);

function fingerChain(base: V3, lengths: number[], splay: number, curl: number): V3[] {
  const dx = Math.sin(splay);
  const dy = Math.cos(splay);
  const out: V3[] = [];
  let [x, y, z] = base;
  let angle = 0;
  lengths.forEach((len, k) => {
    angle += BEND[k] * curl;
    x += len * dx * Math.cos(angle);
    y += len * dy * Math.cos(angle);
    z -= len * Math.sin(angle);
    out.push([x, y, z]);
  });
  return out;
}

const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function poseHand(p: Pose): HandLandmark[] {
  const local: V3[] = new Array(21);
  local[0] = [0, 0, 0];
  KNUCKLES.forEach((k, f) => {
    const base = 5 + f * 4;
    local[base] = k;
    const curl = f === 0 ? Math.max(p.curl, p.pinch * 0.45) : f >= 2 ? Math.max(p.curl, p.vee) : p.curl;
    const chain = fingerChain(k, SEGMENTS[f], SPLAY[f] * p.spread, curl);
    chain.forEach((v, j) => (local[base + 1 + j] = v));
  });

  // Thumb: an open chain that swings across the palm as the hand closes.
  const fold = Math.max(p.curl, p.vee);
  const swing = (-38 + 26 * fold) * DEG;
  const cmc: V3 = [-0.22, 0.22, -0.02];
  const thumb = fingerChain(cmc, [0.3, 0.24, 0.21], swing, fold * 0.6);
  local[1] = cmc;
  [local[2], local[3], local[4]] = thumb;
  if (p.pinch > 0) {
    const target = lerp3(local[8], local[7], 0.15);
    local[4] = lerp3(local[4], target, p.pinch);
    const mid = lerp3(local[2], local[4], 0.55);
    local[3] = lerp3(local[3], [mid[0] - 0.08, mid[1], mid[2] - 0.04], p.pinch);
  }

  const c = Math.cos(p.roll);
  const s = Math.sin(p.roll);
  return local.map(([x, y, z]) => {
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    return { x: p.cx + (rx * p.size) / FRAME_ASPECT, y: p.cy - ry * p.size, z: z * p.size * 0.6 };
  });
}

// [time ms, pose]; the last key equals the first so the clip loops without a jump.
const OPEN = { curl: 0.05, pinch: 0, spread: 1, vee: 0 };
const PINCH = { curl: 0.15, pinch: 1, spread: 0.8, vee: 0 };
const FIST = { curl: 1, pinch: 0, spread: 0.7, vee: 0 };
const VEE = { curl: 0.05, pinch: 0, spread: 1.5, vee: 1 };
const KEYS: Array<[number, Pose]> = [
  [0, { cx: 0.52, cy: 0.8, size: 0.3, roll: 0.05, ...OPEN }],
  [1600, { cx: 0.47, cy: 0.74, size: 0.32, roll: -0.12, ...OPEN }],
  [2300, { cx: 0.46, cy: 0.74, size: 0.32, roll: -0.1, ...PINCH }],
  [3600, { cx: 0.42, cy: 0.7, size: 0.33, roll: -0.05, ...PINCH }],
  [4300, { cx: 0.4, cy: 0.7, size: 0.32, roll: 0.1, ...OPEN }],
  [5300, { cx: 0.56, cy: 0.76, size: 0.29, roll: 0.25, ...OPEN, spread: 1.4 }],
  [6000, { cx: 0.57, cy: 0.77, size: 0.29, roll: 0.2, ...FIST }],
  [7200, { cx: 0.55, cy: 0.75, size: 0.3, roll: 0.15, ...FIST }],
  [8000, { cx: 0.54, cy: 0.78, size: 0.3, roll: -0.2, ...OPEN, spread: 1.3 }],
  [9000, { cx: 0.5, cy: 0.79, size: 0.31, roll: 0.3, ...OPEN }],
  [10600, { cx: 0.49, cy: 0.79, size: 0.3, roll: 0.36, ...OPEN }],
  [11300, { cx: 0.5, cy: 0.76, size: 0.31, roll: 0.0, ...VEE }],
  [12400, { cx: 0.51, cy: 0.76, size: 0.31, roll: -0.05, ...VEE }],
  [13200, { cx: 0.52, cy: 0.79, size: 0.3, roll: 0.05, ...OPEN }],
  [14000, { cx: 0.52, cy: 0.8, size: 0.3, roll: 0.05, ...OPEN }],
];

// The Record state over the clip: recording 5.0-8.6 s (it spans a fist and its release),
// no hand tracked 9.0-10.6 s (out of view), and one reset at 12.0 s (the victory sign held).
const RECORDING: [number, number] = [5000, 8600];
const NO_HAND: [number, number] = [9000, 10600];
const RESET_AT = 12000;
const inside = (t: number, [a, b]: [number, number]) => t >= a && t < b;

const ease = (k: number) => k * k * (3 - 2 * k);

function poseAt(t: number): Pose {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
  const [t0, a] = KEYS[i];
  const [t1, b] = KEYS[i + 1];
  const k = ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  const out = {} as Pose;
  for (const key of Object.keys(a) as Array<keyof Pose>) out[key] = a[key] + (b[key] - a[key]) * k;
  // A little tremor, so the still parts still read as a live hand.
  out.cx += Math.sin(t / 310) * 0.004;
  out.cy += Math.sin(t / 470 + 1) * 0.004;
  return out;
}

/**
 * A 14 s looping clip at 30 fps that plays every hand-art event: open, pinch, release, recording
 * (with a fist and release inside it), the hand out of view, the victory sign and a reset.
 * Deterministic.
 */
export function syntheticClip(fps = 30): HandClip {
  const duration = KEYS[KEYS.length - 1][0];
  const frames: ClipFrame[] = [];
  const n = Math.round((duration * fps) / 1000);
  for (let i = 0; i <= n; i++) {
    const t = Math.round((i * 1000) / fps);
    const p = poseAt(i === n ? 0 : t); // the last frame repeats the first
    const tt = i === n ? 0 : t;
    const lost = inside(tt, NO_HAND);
    frames.push({
      t,
      landmarks: lost ? null : poseHand(p),
      gripperClosed: !lost && (p.pinch > 0.6 || p.curl > 0.7),
      recording: inside(tt, RECORDING),
      resets: tt >= RESET_AT ? 1 : 0,
    });
  }
  return { version: 1, source: "synthetic", frames };
}
