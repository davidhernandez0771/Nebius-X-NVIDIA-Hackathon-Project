// A small verlet mass-spring cloth for the landing page's pinch sheet.
//
// Pure: typed arrays in, typed arrays out, no three.js and no DOM, so the physics is tested on its
// own and the renderer only copies `pos` into a geometry.
//
// The sheet is a cols x rows grid in the z = 0 plane, row 0 at the top. It is not tacked down by
// default: a "home" pull on every particle holds it in place, like fabric resting on a table, so
// a pinch drags it and the cloth around the pinch trails behind and bunches. (Tacks are optional.)
// Three kinds of distance links hold it together:
//   structural (right and down neighbours) at full stiffness, so it barely stretches;
//   shear (both diagonals of each cell), so cells don't collapse sideways;
//   bend (two apart), soft, so it folds into creases instead of staying a stiff plate.
// Because links resist compression too, pushing the cloth together has to go out of the plane:
// that is where the folds come from. A stronger home pull brings it back flat once it is let go.
// One particle at a time can be grabbed; it eases toward a target and the links drag the rest.

export interface ClothSpec {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Particle indices that are tacked down (e.g. cornerPins). Defaults to none. */
  pins?: number[];
}

export interface Cloth {
  cols: number;
  rows: number;
  count: number;
  width: number;
  height: number;
  spacingX: number;
  spacingY: number;
  /** xyz per particle; what the renderer draws. */
  pos: Float32Array;
  /** Last step's positions (verlet keeps velocity as pos - prev). */
  prev: Float32Array;
  /** The flat sheet: where each particle wants to return. */
  rest: Float32Array;
  /** 0 for tacked particles, 1 otherwise. */
  invMass: Float32Array;
  /** Pairs of particle indices, one pair per link. */
  links: Uint32Array;
  linkRest: Float32Array;
  linkStiff: Float32Array;
  /** The grabbed particle, or -1. */
  grabbed: number;
  target: Float32Array;
}

export interface StepParams {
  /** Fraction of velocity lost per step. */
  damping: number;
  /**
   * Pull back toward rest per step, as a fraction of the distance. Verlet carries the correction
   * into the velocity, so this acts as a soft spring (with `damping` keeping it from ringing).
   */
  home: number;
  /** The same while something is held: weaker, so the cloth drapes freely in the hand. */
  homeWhileGrabbed: number;
  /** How fast a tack that was pulled off goes back to its spot. */
  pinReturn: number;
  /** Fraction of the way to its target the grabbed particle moves per step (smooths hand jitter). */
  follow: number;
  iterations: number;
  /** y acceleration in units/s^2 (negative is down). 0: the sheet hangs on a wall, no droop. */
  gravity: number;
}

export const DEFAULT_STEP: StepParams = {
  damping: 0.035,
  home: 0.03,
  homeWhileGrabbed: 0.004,
  pinReturn: 0.12,
  follow: 0.35,
  iterations: 14,
  gravity: 0,
};

const STIFF_STRUCTURAL = 1;
const STIFF_SHEAR = 0.8;
const STIFF_BEND = 0.12;

const SETTLED_SPEED = 2e-5;
const SETTLED_DISTANCE = 1e-3;

export function cornerPins(cols: number, rows: number): number[] {
  return [0, cols - 1, (rows - 1) * cols, rows * cols - 1];
}

export function createCloth(spec: ClothSpec): Cloth {
  const { cols, rows, width, height } = spec;
  const count = cols * rows;
  const spacingX = width / (cols - 1);
  const spacingY = height / (rows - 1);
  const rest = new Float32Array(count * 3);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3;
      rest[i] = -width / 2 + c * spacingX;
      rest[i + 1] = height / 2 - r * spacingY;
    }

  const invMass = new Float32Array(count).fill(1);
  for (const p of spec.pins ?? []) invMass[p] = 0;

  const pairs: number[] = [];
  const stiff: number[] = [];
  const link = (a: number, b: number, k: number) => {
    pairs.push(a, b);
    stiff.push(k);
  };
  const id = (c: number, r: number) => r * cols + c;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) link(id(c, r), id(c + 1, r), STIFF_STRUCTURAL);
      if (r + 1 < rows) link(id(c, r), id(c, r + 1), STIFF_STRUCTURAL);
    }
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      link(id(c, r), id(c + 1, r + 1), STIFF_SHEAR);
      link(id(c + 1, r), id(c, r + 1), STIFF_SHEAR);
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 2 < cols) link(id(c, r), id(c + 2, r), STIFF_BEND);
      if (r + 2 < rows) link(id(c, r), id(c, r + 2), STIFF_BEND);
    }

  const links = Uint32Array.from(pairs);
  const linkRest = new Float32Array(stiff.length);
  for (let k = 0; k < stiff.length; k++) {
    const a = links[2 * k] * 3;
    const b = links[2 * k + 1] * 3;
    linkRest[k] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
  }

  return {
    cols,
    rows,
    count,
    width,
    height,
    spacingX,
    spacingY,
    pos: rest.slice(),
    prev: rest.slice(),
    rest,
    invMass,
    links,
    linkRest,
    linkStiff: Float32Array.from(stiff),
    grabbed: -1,
    target: new Float32Array(3),
  };
}

/** Grabs particle `index`; it eases toward `target` (default: where it is now). */
export function grab(cloth: Cloth, index: number, target?: ArrayLike<number>): void {
  if (index < 0 || index >= cloth.count) return;
  cloth.grabbed = index;
  setTarget(cloth, target ?? cloth.pos.subarray(index * 3, index * 3 + 3));
}

export function setTarget(cloth: Cloth, target: ArrayLike<number>): void {
  cloth.target[0] = target[0];
  cloth.target[1] = target[1];
  cloth.target[2] = target[2];
}

export function release(cloth: Cloth): void {
  cloth.grabbed = -1;
}

/** Offsets z by f(restX, restY) with no velocity: a ripple the home pull then smooths out. */
export function disturb(cloth: Cloth, f: (x: number, y: number) => number): void {
  for (let i = 0; i < cloth.count; i++) {
    if (cloth.invMass[i] === 0) continue;
    const z = f(cloth.rest[i * 3], cloth.rest[i * 3 + 1]);
    cloth.pos[i * 3 + 2] += z;
    cloth.prev[i * 3 + 2] += z;
  }
}

/** Advances one fixed step of `dt` seconds. Returns the fastest particle's speed (units/step). */
export function stepCloth(cloth: Cloth, dt: number, params: StepParams = DEFAULT_STEP): number {
  const { pos, prev, rest, invMass, grabbed, target } = cloth;
  const keep = 1 - params.damping;
  const home = grabbed >= 0 ? params.homeWhileGrabbed : params.home;
  const g = params.gravity * dt * dt;

  for (let i = 0; i < cloth.count; i++) {
    const o = i * 3;
    if (i === grabbed) {
      for (let k = 0; k < 3; k++) {
        prev[o + k] = pos[o + k];
        pos[o + k] += (target[k] - pos[o + k]) * params.follow;
      }
    } else if (invMass[i] === 0) {
      // a tack: it doesn't move, except back to its spot after being pulled off it
      for (let k = 0; k < 3; k++) {
        prev[o + k] = pos[o + k];
        const d = rest[o + k] - pos[o + k];
        pos[o + k] = Math.abs(d) < 1e-5 ? rest[o + k] : pos[o + k] + d * params.pinReturn;
      }
    } else {
      for (let k = 0; k < 3; k++) {
        const v = (pos[o + k] - prev[o + k]) * keep;
        prev[o + k] = pos[o + k];
        pos[o + k] += v + (rest[o + k] - pos[o + k]) * home;
      }
      pos[o + 1] += g;
    }
  }

  const { links, linkRest, linkStiff } = cloth;
  const n = linkRest.length;
  for (let it = 0; it < params.iterations; it++) {
    for (let k = 0; k < n; k++) {
      const a = links[2 * k];
      const b = links[2 * k + 1];
      const wa = a === grabbed ? 0 : invMass[a];
      const wb = b === grabbed ? 0 : invMass[b];
      const w = wa + wb;
      if (w === 0) continue;
      const ao = a * 3;
      const bo = b * 3;
      const dx = pos[bo] - pos[ao];
      const dy = pos[bo + 1] - pos[ao + 1];
      const dz = pos[bo + 2] - pos[ao + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue; // coincident: no direction to push along
      const s = (linkStiff[k] * (len - linkRest[k])) / (len * w);
      pos[ao] += dx * s * wa;
      pos[ao + 1] += dy * s * wa;
      pos[ao + 2] += dz * s * wa;
      pos[bo] -= dx * s * wb;
      pos[bo + 1] -= dy * s * wb;
      pos[bo + 2] -= dz * s * wb;
    }
  }

  let maxSpeed = 0;
  for (let i = 0; i < cloth.count; i++) {
    const o = i * 3;
    const sp = Math.hypot(pos[o] - prev[o], pos[o + 1] - prev[o + 1], pos[o + 2] - prev[o + 2]);
    if (sp > maxSpeed) maxSpeed = sp;
  }
  return maxSpeed;
}

/** Nothing held, nothing moving, and back flat: the renderer can stop drawing frames. */
export function isSettled(cloth: Cloth): boolean {
  if (cloth.grabbed >= 0) return false;
  const { pos, prev, rest } = cloth;
  for (let i = 0; i < pos.length; i++) {
    if (Math.abs(pos[i] - prev[i]) > SETTLED_SPEED) return false;
    if (Math.abs(pos[i] - rest[i]) > SETTLED_DISTANCE) return false;
  }
  return true;
}

/** Puts every particle exactly at rest, at rest. Call once isSettled() is true. */
export function snapToRest(cloth: Cloth): void {
  cloth.pos.set(cloth.rest);
  cloth.prev.set(cloth.rest);
}

/**
 * Fixed-step accumulator: how many `fixed` steps to run for a frame of `dt` seconds, and the time
 * left over for next frame. Long pauses (a hidden tab) are capped at `maxSteps` and the backlog is
 * dropped, so the cloth never fast-forwards or stalls the frame.
 */
export function stepsFor(carry: number, dt: number, fixed: number, maxSteps = 4): { steps: number; carry: number } {
  if (!(dt > 0) || !Number.isFinite(dt)) return { steps: 0, carry };
  const total = carry + dt;
  const steps = Math.floor(total / fixed + 1e-9);
  if (steps > maxSteps) return { steps: maxSteps, carry: 0 };
  return { steps, carry: Math.max(0, total - steps * fixed) };
}
