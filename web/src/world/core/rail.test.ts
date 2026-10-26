import { describe, expect, it } from "vitest";
import { arcPose, fillFrames, layoutRail, locate, mixPose, poseAt, reducedPoseAt, restIndexAt, smoother, through, type RailStation } from "./rail";
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
  // intro-proof (2026-10-26): the browser keeps scroll in whole (device) pixels, so a jump to a station's start can
  // land a rounding hair short of it (18.9 viewports is not a whole number of pixels at most heights).
  it("counts a scroll within half a pixel short of a station's start as there", () => {
    const tiny = layoutRail([{ ...a, length: 18.9 }, { ...b, travel: 0 }], 721);
    const start = tiny.spans[1].start;
    expect(locate(tiny, start - 0.4)).toEqual({ index: 1, phase: "dwell", t: 0, current: 1 });
    expect(locate(tiny, start - 1)).toMatchObject({ index: 0, current: 0 });
    // With a travel, the same: the travel has begun.
    expect(locate(rail, 199.7)).toEqual({ index: 1, phase: "travel", t: 0, current: 0 });
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

describe("reducedPoseAt", () => {
  it("holds the rest pose, but follows a `follow` station's dwell step by step", () => {
    const still = (x: number) => ({ position: [x, 0, 0] as const, target: [x, 0, -1] as const, fov: 40 });
    const a = { id: "intro" as const, anchor: [0, 0, 0] as const, travel: 0, length: 1, camera: () => still(0), rest: still(9) };
    const b = { id: "descent" as const, anchor: [0, 0, 0] as const, travel: 0.5, length: 1, camera: (t: number) => still(10 + t), follow: true };
    const rail = layoutRail([a, b], 100);
    expect(reducedPoseAt([a, b], rail, 50).pose.position[0]).toBe(9);
    expect(reducedPoseAt([a, b], rail, 200).pose.position[0]).toBeCloseTo(10.5, 6);
  });
});

describe("arcPose", () => {
  const at = (deg: number, r: number, y: number): CameraPose => {
    const a = (deg * Math.PI) / 180;
    return { position: [r * Math.cos(a), y, r * Math.sin(a)], target: [0, y, 0], fov: 40 };
  };

  it("goes round the axis the short way, keeping its distance, where mixPose cuts across", () => {
    const from = at(-80, 10, 12);
    const to = at(80, 10, 10);
    const mid = arcPose(from, to, 0.5);
    expect(Math.hypot(mid.position[0], mid.position[2])).toBeCloseTo(10, 9);
    expect(Math.atan2(mid.position[2], mid.position[0])).toBeCloseTo(0, 9);
    expect(mid.position[1]).toBeCloseTo(11, 9);
    const straight = mixPose(from, to, 0.5);
    expect(Math.hypot(straight.position[0], straight.position[2])).toBeLessThan(2);
    // Across +-180 degrees it still takes the short way.
    const wrap = arcPose(at(170, 10, 0), at(-170, 10, 0), 0.5);
    expect(wrap.position[0]).toBeCloseTo(-10, 9);
  });

  it("ends exactly on its two poses, round any axis", () => {
    const a = at(30, 8, 1);
    const b = at(120, 6, 3);
    for (const axis of [[0, 0], [1, -2]] as const) {
      const p0 = arcPose(a, b, 0, axis);
      const p1 = arcPose(a, b, 1, axis);
      p0.position.forEach((v, i) => expect(v).toBeCloseTo(a.position[i], 9));
      p1.position.forEach((v, i) => expect(v).toBeCloseTo(b.position[i], 9));
    }
  });
});
