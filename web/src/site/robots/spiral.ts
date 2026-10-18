// The loose spiral of cartridges: a helix underneath, but every cartridge gets its own tilt, reach, size and spacing,
// and a few reach far out ("messy but controlled", after the Bizarro cassette frames). Unlike the prototype, the
// layout is collision-free: each cartridge is lifted, and its jitter re-rolled if the lift gets large, until its
// oriented box clears every cartridge below it.
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { obbFromMatrix, obbOverlap, type Obb } from "./obb";

export const N = 30;
export const STEP_A = 0.42; // radians around the helix per cartridge
export const RADIUS = 1.25;
export const MAIN_SLOTS = [3, 8, 13, 17, 21, 25]; // where the six robots sit in the pile
/** Verified copies that stick out much further than the rest (and get cut off by the frame). */
export const REACH_SLOTS = [6, 11, 19, 23, 28];
export const REACH = 0.95;
/** Idle bob amplitude; neighbours can bob toward each other, so the layout keeps CLEARANCE > 2 × BOB. */
export const BOB = 0.025;
export const CLEARANCE = 0.06;
/** How far a picked cartridge slides out along its radius, and rises, at out = 1. */
export const SLIDE_OUT = 1.9;
export const SLIDE_UP = 0.3;

// Cartridge body 2.3 × 2.5 × 0.34, the ribbed step on top reaches y = 1.775, the window pokes 0.01 past the faces.
export const CART_HALF: [number, number, number] = [1.15, 1.0125, 0.18];
const HALF_OFFSET = new Vector3(0, 0.2625, 0);

export function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
export function jit(seed: number, a: number): number {
  return (rnd(seed) * 2 - 1) * a;
}

export type Tilt = { x: number; y: number; z: number; rad: number; scale: number };
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

function tilt(seed: number, reach: boolean): Tilt {
  return {
    x: -Math.PI / 2 + 0.2 + jit(seed + 1.1, 0.5),
    z: Math.PI / 2 + jit(seed + 1.9, 0.42),
    y: jit(seed + 2.3, 0.5),
    rad: reach ? RADIUS + REACH + rnd(seed + 2.9) * 0.4 : RADIUS + jit(seed + 2.9, 0.55),
    scale: 1 + jit(seed + 3.7, 0.12),
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
export const PART_UP = 1.3;
export const PART_DOWN = 0.7;

/** Vertical shift of cartridge k given each main robot's slide-out amount (outs[ri] in 0..1). */
export function pileOffset(k: number, outs: number[]): number {
  let dy = 0;
  for (let ri = 0; ri < MAIN_SLOTS.length; ri++) {
    const slot = MAIN_SLOTS[ri];
    if (k > slot) dy += PART_UP * outs[ri];
    else if (k < slot) dy -= PART_DOWN * outs[ri];
  }
  return dy;
}

// Scratch objects for composeCartridgeMatrix (it runs 30× per frame; no allocations).
const _p = new Vector3(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3(), _pivot = new Matrix4(), _local = new Matrix4();
const _axisY = new Vector3(0, 1, 0);

function composeAt(target: Matrix4, pivotY: number, pivotRot: number, base: Tilt, out: number, bob: number): Matrix4 {
  _pivot.makeRotationAxis(_axisY, pivotRot).setPosition(0, pivotY, 0);
  _p.set(base.rad + out * SLIDE_OUT, bob + out * SLIDE_UP, 0);
  _e.set(base.x * (1 - out) + (-Math.PI / 2 + 0.62) * out, base.y * (1 - out), base.z * (1 - out) + (Math.PI / 2) * out);
  _local.compose(_p, _q.setFromEuler(_e), _s.setScalar(base.scale));
  return target.multiplyMatrices(_pivot, _local);
}

/**
 * Writes a cartridge's matrix in spiral space into `target`: its pivot (lifted by `dy` while the pile parts), its
 * tilt, slide-out `out`, idle `bob` and size. Allocation-free; used for the instanced meshes every frame.
 */
export function composeCartridgeMatrix(target: Matrix4, item: SpiralItem, out: number, bob: number, dy: number): Matrix4 {
  return composeAt(target, item.pivotY + dy, item.pivotRot, item.base, out, bob);
}

/** The oriented box of a cartridge drawn with matrix m (from composeCartridgeMatrix). */
export function cartridgeObbFromMatrix(m: Matrix4, item: SpiralItem): Obb {
  const s = item.base.scale;
  return obbFromMatrix(m, [CART_HALF[0] * s, CART_HALF[1] * s, CART_HALF[2] * s], HALF_OFFSET);
}

function obbAt(pivotY: number, pivotRot: number, base: Tilt, out = 0): Obb {
  const m = composeAt(new Matrix4(), pivotY, pivotRot, base, out, 0);
  const s = base.scale;
  return obbFromMatrix(m, [CART_HALF[0] * s, CART_HALF[1] * s, CART_HALF[2] * s], HALF_OFFSET);
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
    const pivotRot = k * STEP_A + jit(k + 0.7, 0.3);
    const reach = REACH_SLOTS.includes(k);
    const nominal = y + 0.42 + jit(k + 0.3, 0.14);
    let best: { y: number; base: Tilt } | null = null;
    for (let attempt = 0; attempt <= REROLLS; attempt++) {
      const base = tilt(k + attempt * 101, reach);
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
