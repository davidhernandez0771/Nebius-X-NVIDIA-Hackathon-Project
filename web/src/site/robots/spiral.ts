// The loose spiral of cartridges: a helix underneath, but every cartridge gets its own tilt, reach and spacing
// ("messy but controlled"). Unlike the prototype, the layout is collision-free: each cartridge is lifted, and its
// jitter re-rolled if the lift gets large, until its oriented box clears every cartridge below it.
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { obbFromMatrix, obbOverlap, type Obb } from "./obb";

export const N = 30;
export const STEP_A = 0.42; // radians around the helix per cartridge
export const RADIUS = 1.25;
export const MAIN_SLOTS = [3, 8, 13, 17, 21, 25]; // where the six robots sit in the pile
/** Idle bob amplitude; neighbours can bob toward each other, so the layout keeps CLEARANCE > 2 × BOB. */
export const BOB = 0.025;
export const CLEARANCE = 0.06;
/** How far a picked cartridge slides out along its radius, and rises, at out = 1. */
export const SLIDE_OUT = 1.9;
export const SLIDE_UP = 0.3;

// Cartridge body 2.3 × 2.5 × 0.34, the ribbed step on top reaches y = 1.775, the window pokes 0.01 past the faces.
const HALF: [number, number, number] = [1.15, 1.0125, 0.18];
const HALF_OFFSET = new Vector3(0, 0.2625, 0);

export function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
export function jit(seed: number, a: number): number {
  return (rnd(seed) * 2 - 1) * a;
}

export type Tilt = { x: number; y: number; z: number; rad: number };
export type SpiralItem = {
  k: number;
  /** Index into ROBOTS for the six main cartridges, -1 for a verified copy. */
  ri: number;
  /** Copy number printed on a verified copy's label (0 for a main cartridge). */
  copyN: number;
  pivotY: number;
  pivotRot: number;
  base: Tilt;
  phase: number;
};

function tilt(seed: number): Tilt {
  return {
    x: -Math.PI / 2 + 0.2 + jit(seed + 1.1, 0.34),
    z: Math.PI / 2 + jit(seed + 1.9, 0.28),
    y: jit(seed + 2.3, 0.3),
    rad: RADIUS + jit(seed + 2.9, 0.4),
  };
}

/** The cartridge's local pose on its pivot: at rest for out = 0, slid out and facing the camera for out = 1. */
export function cartridgePose(base: Tilt, out = 0, bob = 0): { position: [number, number, number]; rotation: [number, number, number] } {
  return {
    position: [base.rad + out * SLIDE_OUT, bob + out * SLIDE_UP, 0],
    rotation: [base.x * (1 - out) + (-Math.PI / 2 + 0.62) * out, base.y * (1 - out), base.z * (1 - out) + (Math.PI / 2) * out],
  };
}

/** While a robot slides out, the pile parts around it so it never scrapes a neighbour. */
export const PART_UP = 1.0;
export const PART_DOWN = 0.7;

/** Vertical shift of cartridge k given each main robot's slide-out amount (outs[ri] in 0..1). */
export function pileOffset(k: number, outs: number[]): number {
  let dy = 0;
  MAIN_SLOTS.forEach((slot, ri) => {
    if (k > slot) dy += PART_UP * outs[ri];
    else if (k < slot) dy -= PART_DOWN * outs[ri];
  });
  return dy;
}

function obbAt(pivotY: number, pivotRot: number, base: Tilt, out = 0): Obb {
  const pose = cartridgePose(base, out);
  const pivot = new Matrix4().compose(new Vector3(0, pivotY, 0), new Quaternion().setFromEuler(new Euler(0, pivotRot, 0)), new Vector3(1, 1, 1));
  const local = new Matrix4().compose(new Vector3(...pose.position), new Quaternion().setFromEuler(new Euler(...pose.rotation)), new Vector3(1, 1, 1));
  return obbFromMatrix(pivot.multiply(local), HALF, HALF_OFFSET);
}

/** The cartridge's oriented box in spiral space (the spiral's own spin is left out: it turns every box alike). */
export function cartridgeObb(item: SpiralItem, out = 0): Obb {
  return obbAt(item.pivotY, item.pivotRot, item.base, out);
}

const LIFT = 0.02; // search step when lifting a cartridge clear
const REROLL_AFTER = 0.3; // a lift bigger than this tries other jitters first
const REROLLS = 6;

export function layoutSpiral(): { items: SpiralItem[]; pileTop: number } {
  const items: SpiralItem[] = [];
  const placed: Obb[] = [];
  let y = 0;
  for (let k = 0; k < N; k++) {
    const pivotRot = k * STEP_A + jit(k + 0.7, 0.22);
    const nominal = y + 0.42 + jit(k + 0.3, 0.14);
    let best: { y: number; base: Tilt } | null = null;
    for (let attempt = 0; attempt <= REROLLS; attempt++) {
      const base = tilt(k + attempt * 101);
      let cy = nominal;
      while (placed.some((o) => obbOverlap(obbAt(cy, pivotRot, base), o, CLEARANCE))) cy += LIFT;
      if (!best || cy < best.y) best = { y: cy, base };
      if (cy - nominal <= REROLL_AFTER) break;
    }
    y = best!.y;
    const ri = MAIN_SLOTS.indexOf(k);
    const item: SpiralItem = { k, ri, copyN: ri >= 0 ? 0 : 1 + ((k * 37) % 99), pivotY: y, pivotRot, base: best!.base, phase: rnd(k + 4) * 6 };
    items.push(item);
    placed.push(cartridgeObb(item));
  }
  return { items, pileTop: y };
}
