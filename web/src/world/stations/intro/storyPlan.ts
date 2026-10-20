// The intro's plan, in viewport heights of scroll (vh): the hero, then four beats (the problem,
// S·A·N·T, the proof, Nemotron's jobs), then the morph where the glass logo becomes the ring. Like
// Active Theory's "About": one dark space, the logo spinning in the middle, the words next to it
// (Story.tsx) and nothing else; the scroll drives the logo's turn and pose and each beat's reveal.
// Pure, so the timing is tested; Scene.tsx and Story.tsx read it every frame. (Not story.ts: next to
// Story.tsx that name breaks Windows, see fileNames.test.ts.)
import { mixPose, smoother } from "../../core/rail";
import { stop } from "../../scene/layout";
import type { CameraPose, Vec3 } from "../../core/types";
import { LOGO } from "./layout";

export const PLAN = { hero: 1.2, beat: 1.5, beats: 4, morph: 1 } as const;

/** The hero and the four beats. */
export const BEATS = 1 + PLAN.beats;

/** Where the beats end and the morph starts. */
export const BEATS_END = PLAN.hero + PLAN.beats * PLAN.beat;

/** The intro's dwell in vh. */
export const INTRO_VH = BEATS_END + PLAN.morph;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Beat i's span [start, end) in vh. Beat 0 is the hero. */
export function beatSpan(i: number): [number, number] {
  if (i === 0) return [0, PLAN.hero];
  const a = PLAN.hero + (i - 1) * PLAN.beat;
  return [a, a + PLAN.beat];
}

export interface BeatState {
  /** 0–1 through the span. */
  k: number;
  /** Opacity: in at the start of the span, out at its end. */
  shown: number;
  /** The headline's line-mask reveal (and the column's stagger): 0–1 over the first part of the span. */
  reveal: number;
}

/** How beat i shows at scroll `vh`. Only one beat is ever on screen: the next starts as the last ends. */
export function beatState(vh: number, i: number): BeatState {
  const [a, b] = beatSpan(i);
  const len = b - a;
  const k = clamp01((vh - a) / len);
  if (i === 0) return { k, shown: 1 - smooth(a + len * 0.55, b, vh), reveal: 1 };
  const shown = vh < a || vh >= b ? 0 : smooth(a, a + len * 0.14, vh) * (1 - smooth(b - len * 0.16, b, vh));
  return { k, shown, reveal: clamp01((vh - a) / (len * 0.36)) };
}

/** Whole turns the logo makes over the beats: it ends square to the camera for the morph. */
const TURNS = 2;

/** The logo's lean toward the camera at each beat's middle (radians about x), back to 0 for the morph. */
const TILTS = [0.16, -0.3, 0.28, -0.22, 0.24];

export interface LogoPose {
  /** Turn about its vertical axis (radians), only ever forward with the scroll. */
  turn: number;
  /** Lean about its horizontal axis (radians). */
  tilt: number;
  /** 0–1: the glass logo becoming the ring (Scene.tsx). */
  morph: number;
}

export function logoPose(vh: number): LogoPose {
  const turn = TURNS * Math.PI * 2 * smoother(clamp01(vh / BEATS_END));
  const keys: [number, number][] = TILTS.map((tilt, i) => {
    const [a, b] = beatSpan(i);
    return [i === 0 ? 0 : (a + b) / 2, tilt];
  });
  keys.push([BEATS_END, 0]);
  let tilt = 0;
  if (vh <= keys[0][0]) tilt = keys[0][1];
  else if (vh >= BEATS_END) tilt = 0;
  else
    for (let i = 1; i < keys.length; i++)
      if (vh <= keys[i][0]) {
        const [a, ta] = keys[i - 1];
        const [b, tb] = keys[i];
        tilt = ta + (tb - ta) * smoother((vh - a) / (b - a));
        break;
      }
  return { turn, tilt, morph: smooth(BEATS_END, INTRO_VH, vh) };
}

const at = (x: number, y: number, z: number): CameraPose => ({ position: [x, y, z], target: LOGO as Vec3, fov: 40 });

/**
 * The camera, by vh: square on for the hero, drifting a little to each side as the beats change
 * (the words sit on alternate sides), and square on again, nearer, for the morph into the ring.
 */
const CAMERA_KEYS: [number, CameraPose][] = [
  // Blender's "Title" stop: the hero, the logo big in the middle.
  [0, stop("Title")],
  [beatSpan(1)[0] + 0.4, at(-2.4, 37.1, 31)],
  [beatSpan(2)[0] + 0.4, at(2.4, 35.8, 31)],
  [beatSpan(3)[0] + 0.4, at(-1.6, 37.3, 31.5)],
  [beatSpan(4)[0] + 0.4, at(2, 36.4, 30.5)],
  [BEATS_END + PLAN.morph * 0.6, at(0, 36, 27)],
];

/** Where the intro ends: the ring square on. The descent starts from here. */
export const PORTAL_VIEW: CameraPose = CAMERA_KEYS[CAMERA_KEYS.length - 1][1];

export function cameraAt(vh: number): CameraPose {
  if (vh <= CAMERA_KEYS[0][0]) return CAMERA_KEYS[0][1];
  for (let i = 1; i < CAMERA_KEYS.length; i++) {
    const [b, pb] = CAMERA_KEYS[i];
    if (vh <= b) {
      const [a, pa] = CAMERA_KEYS[i - 1];
      return mixPose(pa, pb, smoother((vh - a) / (b - a)));
    }
  }
  return PORTAL_VIEW;
}
