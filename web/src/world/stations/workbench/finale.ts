// The finish ("pum"), as a timeline from the moment Finish is pressed: the cartridge clicks down into
// the turntable and springs back with a hair of overshoot, sparks pop off it at the bottom of the
// click, a light sweeps across its shell, and it flies to its place on the spiral (layout.ts
// flightPose). And the print head that runs down the label when a name is printed onto it. Pure, so
// it is tested; the bench's 3D (Scene.tsx) reads it each frame.
import { FLIGHT_S } from "./layout";

export const FINALE = {
  /** The click: down this far (metres) in `pressS`, then back up past rest and settling by `releaseS` more. */
  pressDepth: 0.06,
  pressS: 0.14,
  releaseS: 0.42,
  popAt: 0.14,
  popS: 0.85,
  sweepAt: 0.22,
  sweepS: 0.6,
  /** The flight leaves once the light has crossed. */
  flyAt: 0.95,
  end: 0.95 + FLIGHT_S,
  /** The print head's run down the label. */
  printS: 0.55,
};

export interface FinaleFrame {
  /** Metres up (+) or down (-) from where it stands. */
  press: number;
  /** Its height's scale (a touch squashed at the click). */
  squash: number;
  /** The light across the shell, 0 (not yet) to 1 (gone by). */
  sweep: number;
  /** The sparks, 0 (not yet) to 1 (gone). */
  pop: number;
  /** The flight to the spiral, 0–1. */
  fly: number;
  done: boolean;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
const easeIn = (x: number) => clamp(x) ** 2;

/** The finish at t seconds after Finish (reduced motion: over at once). */
export function finaleAt(t: number, reduced = false): FinaleFrame {
  if (reduced) return { press: 0, squash: 1, sweep: 1, pop: 1, fly: 1, done: true };
  const { pressDepth, pressS, releaseS } = FINALE;
  let press = 0;
  if (t > 0 && t <= pressS) press = -pressDepth * easeIn(t / pressS);
  else if (t > pressS) {
    // Released: a damped spring from the bottom, overshooting rest once by a little.
    const s = (t - pressS) / releaseS;
    press = s >= 1 ? 0 : -pressDepth * Math.exp(-4.2 * s) * Math.cos(Math.PI * 1.35 * s) * (1 - s);
  }
  const squash = 1 + (press / pressDepth) * 0.035;
  const span = (at: number, len: number) => (t < at ? 0 : t >= at + len ? 1 : (t - at) / len);
  const sweep = span(FINALE.sweepAt, FINALE.sweepS);
  const pop = span(FINALE.popAt, FINALE.popS);
  const fly = t < FINALE.flyAt ? 0 : t >= FINALE.end ? 1 : (t - FINALE.flyAt) / FLIGHT_S;
  return { press, squash, sweep: sweep > 0 && sweep < 1 ? easeInOut(sweep) : sweep, pop, fly, done: t >= FINALE.end };
}

function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** A spark's seed-th pseudo-random numbers (0–1), the same every frame. */
function rand(seed: number, k: number): number {
  const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Spark `seed` at u (0–1 of the pop): where it is (metres from the cartridge's middle, y up) and how
 * bright. Out and upward fast, slowing (eased out), falling a little at the end, fading out.
 */
export function popParticle(seed: number, u: number): { x: number; y: number; z: number; alpha: number } {
  const k = clamp(u);
  const a = rand(seed, 1) * Math.PI * 2;
  const up = 0.25 + rand(seed, 2) * 0.9;
  const speed = 0.7 + rand(seed, 3) * 0.9;
  const r = speed * easeOut(k);
  return {
    x: Math.cos(a) * r,
    y: up * easeOut(k) - 0.35 * k * k,
    z: Math.sin(a) * r,
    alpha: k >= 1 ? 0 : (1 - k) ** 1.5,
  };
}

/** How far down the label the print head has run, t seconds after it started (t < 0: none running, all printed). */
export function printWipe(t: number): number {
  if (t < 0) return 1;
  return t >= FINALE.printS ? 1 : easeOut(t / FINALE.printS);
}
