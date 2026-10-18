import { describe, expect, it } from "vitest";
import {
  DEFAULT_STEP,
  cornerPins,
  createCloth,
  disturb,
  grab,
  isSettled,
  release,
  setTarget,
  snapToRest,
  stepCloth,
  stepsFor,
  type Cloth,
} from "./cloth";

const SPEC = { cols: 16, rows: 10, width: 2.4, height: 1.5 };
const DT = 1 / 60;

const at = (c: Cloth, i: number) => [c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]];
const restAt = (c: Cloth, i: number) => [c.rest[i * 3], c.rest[i * 3 + 1], c.rest[i * 3 + 2]];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const idx = (c: Cloth, col: number, row: number) => row * c.cols + col;

function run(c: Cloth, steps: number) {
  for (let i = 0; i < steps; i++) stepCloth(c, DT);
}
function maxRestDistance(c: Cloth) {
  let m = 0;
  for (let i = 0; i < c.count; i++) m = Math.max(m, dist(at(c, i), restAt(c, i)));
  return m;
}
function structuralStretch(c: Cloth) {
  // worst relative length error over the horizontal and vertical neighbours
  let worst = 0;
  for (let r = 0; r < c.rows; r++)
    for (let col = 0; col < c.cols; col++) {
      const i = idx(c, col, r);
      if (col + 1 < c.cols) worst = Math.max(worst, Math.abs(dist(at(c, i), at(c, i + 1)) / c.spacingX - 1));
      if (r + 1 < c.rows) worst = Math.max(worst, Math.abs(dist(at(c, i), at(c, i + c.cols)) / c.spacingY - 1));
    }
  return worst;
}
const finite = (c: Cloth) => Array.from(c.pos).every(Number.isFinite);

describe("cloth: a verlet mass-spring sheet", () => {
  it("lays the grid out row by row from the top-left, centred on the origin, flat at z = 0", () => {
    const c = createCloth(SPEC);
    expect(c.count).toBe(160);
    expect(at(c, 0)[0]).toBeCloseTo(-1.2);
    expect(at(c, 0)[1]).toBeCloseTo(0.75);
    expect(at(c, 0)[2]).toBe(0);
    const last = at(c, c.count - 1);
    expect(last[0]).toBeCloseTo(1.2);
    expect(last[1]).toBeCloseTo(-0.75);
    expect(c.spacingX).toBeCloseTo(2.4 / 15);
    expect(c.spacingY).toBeCloseTo(1.5 / 9);
    expect(Array.from(c.pos)).toEqual(Array.from(c.rest));
  });

  it("is free by default (held only by its pull back to rest), and can be tacked", () => {
    expect(Array.from(createCloth(SPEC).invMass).every((m) => m === 1)).toBe(true);
    const c = createCloth({ ...SPEC, pins: cornerPins(16, 10) });
    expect(cornerPins(16, 10)).toEqual([0, 15, 144, 159]);
    for (const p of cornerPins(16, 10)) expect(c.invMass[p]).toBe(0);
    expect(c.invMass[idx(c, 5, 5)]).toBe(1);
  });

  it("links every structural neighbour, both diagonals of each cell and the bend pairs", () => {
    const c = createCloth(SPEC);
    const structural = 10 * 15 + 16 * 9;
    const shear = 2 * 15 * 9;
    const bend = 10 * 14 + 16 * 8;
    expect(c.linkRest.length).toBe(structural + shear + bend);
    expect(c.links.length).toBe(2 * c.linkRest.length);
    expect(Array.from(c.linkRest).every((l) => l > 0)).toBe(true);
  });

  it("stays put and counts as settled when nothing touches it", () => {
    const c = createCloth(SPEC);
    run(c, 120);
    expect(maxRestDistance(c)).toBeLessThan(1e-6);
    expect(isSettled(c)).toBe(true);
  });

  it("tacks hold under gravity while the cloth between them sags", () => {
    const c = createCloth({ ...SPEC, pins: cornerPins(16, 10) });
    for (let i = 0; i < 120; i++) stepCloth(c, DT, { ...DEFAULT_STEP, gravity: -9.8, home: 0, homeWhileGrabbed: 0 });
    for (const p of cornerPins(16, 10)) expect(dist(at(c, p), restAt(c, p))).toBe(0);
    const mid = idx(c, 8, 5);
    expect(at(c, mid)[1]).toBeLessThan(restAt(c, mid)[1] - 0.005);
  });

  it("a grabbed point eases toward its target and drags its neighbours along", () => {
    const c = createCloth(SPEC);
    const g = idx(c, 8, 5);
    const target = [restAt(c, g)[0], restAt(c, g)[1], 0.4];
    grab(c, g, target);
    stepCloth(c, DT);
    const z1 = at(c, g)[2];
    expect(z1).toBeGreaterThan(0);
    expect(z1).toBeLessThan(0.4); // eased, not teleported
    run(c, 60);
    expect(at(c, g)[2]).toBeCloseTo(0.4, 2);
    expect(at(c, idx(c, 9, 5))[2]).toBeGreaterThan(0.1);
    expect(c.grabbed).toBe(g);
  });

  it("does not stretch much while pulled well out of the sheet", () => {
    const c = createCloth(SPEC);
    const g = idx(c, 8, 5);
    grab(c, g, [restAt(c, g)[0], restAt(c, g)[1], 0.5]);
    run(c, 90);
    expect(structuralStretch(c)).toBeLessThan(0.15);
  });

  it("buckles into folds out of the sheet when pushed together, instead of shrinking flat", () => {
    const c = createCloth(SPEC);
    const g = idx(c, 0, 5); // middle of the left edge
    grab(c, g);
    for (let i = 0; i < 90; i++) {
      // drag it halfway to the centre, slightly lifted, the way a pinch does
      const k = Math.min(1, i / 60);
      setTarget(c, [-1.2 + 0.7 * k, restAt(c, g)[1], 0.12 * k]);
      stepCloth(c, DT);
    }
    let maxZ = 0;
    for (let i = 0; i < c.count; i++) if (i !== g) maxZ = Math.max(maxZ, Math.abs(at(c, i)[2]));
    expect(maxZ).toBeGreaterThan(0.08);
    expect(structuralStretch(c)).toBeLessThan(0.2);
  });

  it("lies flat again after a release, and then sleeps", () => {
    const c = createCloth(SPEC);
    const g = idx(c, 6, 3);
    grab(c, g, [0.3, 0.6, 0.45]);
    run(c, 60);
    expect(isSettled(c)).toBe(false);
    release(c);
    expect(c.grabbed).toBe(-1);
    run(c, 300); // 5 s
    expect(maxRestDistance(c)).toBeLessThan(0.005);
    run(c, 300);
    expect(isSettled(c)).toBe(true);
  });

  it("drapes freely while held (weak home pull), then springs back faster once let go (strong pull)", () => {
    const pull = (params: typeof DEFAULT_STEP) => {
      const c = createCloth(SPEC);
      const far = idx(c, 15, 9);
      grab(c, idx(c, 0, 0), [-1.6, 1.0, 0.3]);
      for (let i = 0; i < 90; i++) stepCloth(c, DT, params);
      const heldDrift = dist(at(c, far), restAt(c, far));
      release(c);
      for (let i = 0; i < 45; i++) stepCloth(c, DT, params);
      return { heldDrift, afterRelease: maxRestDistance(c) };
    };
    const normal = pull(DEFAULT_STEP);
    const stiffWhileHeld = pull({ ...DEFAULT_STEP, homeWhileGrabbed: DEFAULT_STEP.home });
    const weakAfter = pull({ ...DEFAULT_STEP, home: DEFAULT_STEP.homeWhileGrabbed });
    expect(normal.heldDrift).toBeGreaterThan(stiffWhileHeld.heldDrift);
    expect(normal.afterRelease).toBeLessThan(weakAfter.afterRelease);
  });

  it("a grabbed tack can be pulled off, and goes back to its spot on release", () => {
    const c = createCloth({ ...SPEC, pins: cornerPins(16, 10) });
    grab(c, 0, [-1.5, 0.9, 0.2]);
    run(c, 60);
    expect(dist(at(c, 0), restAt(c, 0))).toBeGreaterThan(0.3);
    release(c);
    run(c, 240);
    expect(dist(at(c, 0), restAt(c, 0))).toBeLessThan(1e-3);
  });

  it("motion dies down after a release (damped, no ringing growth)", () => {
    const c = createCloth(SPEC);
    grab(c, idx(c, 8, 5), [0, 0, 0.5]);
    run(c, 40);
    release(c);
    const speed = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s = stepCloth(c, DT);
      return s;
    };
    const early = speed(10);
    const late = speed(120);
    expect(late).toBeLessThan(early);
  });

  it("survives a target on top of a neighbour without NaNs", () => {
    const c = createCloth(SPEC);
    const g = idx(c, 4, 4);
    grab(c, g, restAt(c, g + 1));
    run(c, 120);
    expect(finite(c)).toBe(true);
  });

  it("disturb() offsets the sheet without giving it a kick, and it flattens back", () => {
    const c = createCloth(SPEC);
    disturb(c, (x, y) => 0.05 * Math.sin(3 * x) * Math.cos(2 * y));
    const i = idx(c, 3, 2);
    expect(c.pos[i * 3 + 2]).toBeCloseTo(0.05 * Math.sin(3 * c.rest[i * 3]) * Math.cos(2 * c.rest[i * 3 + 1]));
    expect(c.prev[i * 3 + 2]).toBe(c.pos[i * 3 + 2]);
    expect(isSettled(c)).toBe(false);
    run(c, 480);
    expect(maxRestDistance(c)).toBeLessThan(0.002);
  });

  it("snapToRest() makes a settled sheet exactly flat (no faint leftover shading)", () => {
    const c = createCloth(SPEC);
    disturb(c, () => 0.0004);
    snapToRest(c);
    expect(Array.from(c.pos)).toEqual(Array.from(c.rest));
    expect(Array.from(c.prev)).toEqual(Array.from(c.rest));
  });

  it("is deterministic", () => {
    const a = createCloth(SPEC);
    const b = createCloth(SPEC);
    for (const c of [a, b]) {
      grab(c, 20, [0, 0, 0.3]);
      run(c, 30);
      release(c);
      run(c, 30);
    }
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
  });
});

describe("stepsFor: a fixed-step accumulator", () => {
  it("runs whole steps and carries the remainder", () => {
    expect(stepsFor(0, 1 / 30, 1 / 60)).toEqual({ steps: 2, carry: expect.closeTo(0, 9) });
    const r = stepsFor(0, 0.025, 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.carry).toBeCloseTo(0.025 - 1 / 60);
  });

  it("caps the steps after a long pause (a background tab), dropping the backlog", () => {
    expect(stepsFor(0, 2, 1 / 60, 4)).toEqual({ steps: 4, carry: 0 });
  });

  it("ignores negative or non-finite frame times", () => {
    expect(stepsFor(0.004, -1, 1 / 60)).toEqual({ steps: 0, carry: 0.004 });
    expect(stepsFor(0.004, NaN, 1 / 60)).toEqual({ steps: 0, carry: 0.004 });
  });
});
