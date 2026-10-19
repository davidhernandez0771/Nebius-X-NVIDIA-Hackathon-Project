import { describe, expect, it } from "vitest";
import { fillFrames, layoutRail, locate, mixPose, poseAt, restIndexAt, smoother, through, type RailStation } from "./rail";
import type { CameraPose, StationFrame } from "./types";

const pose = (x: number): CameraPose => ({ position: [x, 0, 10], target: [x, 0, 0], fov: 40 });
const a: RailStation = { id: "intro", anchor: [0, 0, 0], travel: 0, length: 2, camera: (t) => pose(t) };
const b: RailStation = { id: "descent", anchor: [100, 0, 0], travel: 1, length: 1, camera: (t) => pose(t * 2) };
const c: RailStation = { id: "workshop", anchor: [200, 0, 0], travel: 0.5, length: 1, camera: () => pose(0) };
const STATIONS = [a, b, c];
const VH = 100;

describe("layoutRail", () => {
  it("lays stations end to end in viewport heights, the first with no travel", () => {
    const rail = layoutRail(STATIONS, VH);
    expect(rail.spans).toEqual([
      { id: "intro", from: 0, start: 0, end: 200 },
      { id: "descent", from: 200, start: 300, end: 400 },
      { id: "workshop", from: 400, start: 450, end: 550 },
    ]);
    expect(rail.total).toBe(550);
  });
});

describe("locate", () => {
  const rail = layoutRail(STATIONS, VH);
  it("finds the phase and its progress", () => {
    expect(locate(rail, 100)).toEqual({ index: 0, phase: "dwell", t: 0.5, current: 0 });
    expect(locate(rail, 225)).toEqual({ index: 1, phase: "travel", t: 0.25, current: 0 });
    expect(locate(rail, 275)).toEqual({ index: 1, phase: "travel", t: 0.75, current: 1 });
    expect(locate(rail, 350)).toEqual({ index: 1, phase: "dwell", t: 0.5, current: 1 });
  });
  it("clamps above and below the rail", () => {
    expect(locate(rail, -50)).toEqual({ index: 0, phase: "dwell", t: 0, current: 0 });
    expect(locate(rail, 9999)).toEqual({ index: 2, phase: "dwell", t: 1, current: 2 });
  });
});

describe("poseAt", () => {
  const rail = layoutRail(STATIONS, VH);
  it("is continuous at every boundary (no camera jumps)", () => {
    for (const s of rail.spans) {
      for (const y of [s.from, s.start, s.end]) {
        const before = poseAt(STATIONS, rail, y - 1e-6);
        const after = poseAt(STATIONS, rail, y + 1e-6);
        before.position.forEach((v, i) => expect(after.position[i]).toBeCloseTo(v, 3));
        before.target.forEach((v, i) => expect(after.target[i]).toBeCloseTo(v, 3));
      }
    }
  });
  it("travels from the previous station's last pose to the next one's first, eased", () => {
    const mid = poseAt(STATIONS, rail, 250);
    // a ends at anchor 0 + x 1; b starts at anchor 100 + x 0; halfway (smootherstep(0.5) = 0.5).
    expect(mid.position[0]).toBeCloseTo(50.5, 6);
  });
  it("follows the station's own camera in the dwell, in world coordinates", () => {
    expect(poseAt(STATIONS, rail, 350).position).toEqual([101, 0, 10]);
  });
});

describe("reduced motion", () => {
  it("counts a travel as the previous station until halfway, then cuts", () => {
    const rail = layoutRail(STATIONS, VH);
    expect(restIndexAt(rail, 240)).toBe(0);
    expect(restIndexAt(rail, 260)).toBe(1);
  });
});

describe("fillFrames reach", () => {
  it("keeps a station with a longer reach drawn two stations away", () => {
    const d: RailStation = { id: "machine", anchor: [0, 0, 0], travel: 0.5, length: 1, camera: () => pose(0) };
    const wide = [a, { ...b, reach: 2 }, c, d];
    const rail = layoutRail(wide, VH);
    const frames: StationFrame[] = wide.map(() => ({ t: 0, arrive: 0, current: false, near: false }));
    fillFrames(rail, rail.total, frames);
    expect(frames.map((f) => f.near)).toEqual([false, true, true, true]);
  });
});

describe("through", () => {
  it("passes every stop, settling at each", () => {
    const cam = through(pose(0), pose(10), pose(30));
    expect(cam(0).position[0]).toBe(0);
    expect(cam(0.5).position[0]).toBe(10);
    expect(cam(1).position[0]).toBe(30);
    expect(cam(0.25).position[0]).toBeCloseTo(5, 6);
    // Zero speed at the middle stop: a small step either side barely moves.
    expect(Math.abs(cam(0.501).position[0] - 10)).toBeLessThan(1e-3);
    expect(through(pose(4))(0.7).position[0]).toBe(4);
  });
});

describe("fillFrames", () => {
  it("marks passed stations done, the next one arriving, and the current one's neighbours near", () => {
    const rail = layoutRail(STATIONS, VH);
    const frames: StationFrame[] = STATIONS.map(() => ({ t: 0, arrive: 0, current: false, near: false }));
    fillFrames(rail, 420, frames);
    expect(frames[0]).toEqual({ t: 1, arrive: 1, current: false, near: true });
    expect(frames[1]).toEqual({ t: 1, arrive: 1, current: true, near: true });
    expect(frames[2]).toEqual({ t: 0, arrive: 0.4, current: false, near: true });
  });
});

describe("smoother and mixPose", () => {
  it("eases from 0 to 1 with flat ends", () => {
    expect(smoother(0)).toBe(0);
    expect(smoother(1)).toBe(1);
    expect(smoother(0.5)).toBe(0.5);
    expect(smoother(0.01)).toBeLessThan(0.001);
    expect(smoother(-1)).toBe(0);
  });
  it("mixes position, target and fov", () => {
    const m = mixPose(pose(0), { position: [10, 10, 10], target: [10, 0, 0], fov: 60 }, 0.5);
    expect(m).toEqual({ position: [5, 5, 10], target: [5, 0, 0], fov: 50 });
  });
});
