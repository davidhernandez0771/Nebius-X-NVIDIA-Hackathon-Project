// The scroll-driven camera rail: the rail stations laid end to end in scroll pixels, where a scroll
// position is on it, and the camera pose there. Each station is a travel (the camera moving in from
// the previous station's last pose to this one's first) and then a dwell (the station's own camera).
// Pure, so continuity at every boundary is tested.
import type { CameraPose, StationFrame, StationId, StationModule, Vec3 } from "./types";

export type RailStation = Pick<StationModule, "id" | "anchor" | "travel" | "length" | "camera" | "rest" | "reach" | "follow" | "enter" | "cutAt">;

export interface RailSpan {
  id: StationId;
  /** Scroll px where the travel into the station starts. */
  from: number;
  /** Scroll px where the dwell starts (the camera has arrived). */
  start: number;
  /** Scroll px where the dwell ends. */
  end: number;
}

export interface Rail {
  spans: RailSpan[];
  /** Scroll px of the whole rail: the page is this plus one viewport tall. */
  total: number;
  /** Per station: how many stations away it is still drawn (StationModule.reach, default 1). */
  reach: number[];
}

export interface Place {
  /** Index of the span the scroll is in. */
  index: number;
  phase: "travel" | "dwell";
  /** 0–1 through that phase. */
  t: number;
  /** The station the journey counts as at: during a travel, the previous one until halfway. */
  current: number;
}

export function layoutRail(stations: readonly RailStation[], vh: number): Rail {
  let y = 0;
  const spans = stations.map((s, i) => {
    const from = y;
    const start = from + (i === 0 ? 0 : s.travel * vh);
    const end = start + s.length * vh;
    y = end;
    return { id: s.id, from, start, end };
  });
  return { spans, total: y, reach: stations.map((s) => s.reach ?? 1) };
}

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

export function locate(rail: Rail, y: number): Place {
  const { spans } = rail;
  const yc = Math.min(rail.total, Math.max(0, y));
  let index = 0;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (yc >= spans[i].from) {
      index = i;
      break;
    }
  }
  const s = spans[index];
  if (yc < s.start) {
    const t = clamp01((yc - s.from) / (s.start - s.from));
    return { index, phase: "travel", t, current: t < 0.5 && index > 0 ? index - 1 : index };
  }
  const len = s.end - s.start;
  return { index, phase: "dwell", t: len > 0 ? clamp01((yc - s.start) / len) : 1, current: index };
}

/** smootherstep: zero velocity and acceleration at both ends, so travels start and stop softly. */
export const smoother = (u: number) => {
  const x = clamp01(u);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

export function mixPose(a: CameraPose, b: CameraPose, u: number): CameraPose {
  return { position: lerp3(a.position, b.position, u), target: lerp3(a.target, b.target, u), fov: a.fov + (b.fov - a.fov) * u };
}

/** Round the vertical axis through (ax, az): azimuth the short way, distance from the axis and height lerped. */
function arc3(a: Vec3, b: Vec3, u: number, ax: number, az: number): Vec3 {
  const ra = Math.hypot(a[0] - ax, a[2] - az);
  const rb = Math.hypot(b[0] - ax, b[2] - az);
  const pa = Math.atan2(a[2] - az, a[0] - ax);
  let turn = Math.atan2(b[2] - az, b[0] - ax) - pa;
  turn = ((turn + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const r = ra + (rb - ra) * u;
  const p = pa + turn * u;
  return [ax + r * Math.cos(p), a[1] + (b[1] - a[1]) * u, az + r * Math.sin(p)];
}

/**
 * Like mixPose, but round the vertical axis through `axis` (x, z) instead of straight across: the way
 * between two shots facing the spiral from outside keeps its distance from the spiral.
 */
export function arcPose(a: CameraPose, b: CameraPose, u: number, axis: readonly [number, number] = [0, 0]): CameraPose {
  const [ax, az] = axis;
  return { position: arc3(a.position, b.position, u, ax, az), target: arc3(a.target, b.target, u, ax, az), fov: a.fov + (b.fov - a.fov) * u };
}

export function toWorld(anchor: Vec3, p: CameraPose): CameraPose {
  return { position: add(anchor, p.position), target: add(anchor, p.target), fov: p.fov };
}

/** A station's camera at dwell t, in world coordinates. */
export function stationPose(s: RailStation, t: number): CameraPose {
  return toWorld(s.anchor, s.camera(t));
}

/** The one pose a station shows when motion is reduced. */
export function restPose(s: RailStation): CameraPose {
  return toWorld(s.anchor, s.rest ?? s.camera(0.5));
}

/** The camera at scroll y, with full motion. */
export function poseAt(stations: readonly RailStation[], rail: Rail, y: number): CameraPose {
  const p = locate(rail, y);
  const s = stations[p.index];
  if (p.phase === "dwell" || p.index === 0) return stationPose(s, p.t);
  const from = stationPose(stations[p.index - 1], 1);
  if (s.enter) return s.enter(p.t, from);
  return mixPose(from, stationPose(s, 0), smoother(p.t));
}

/** With reduced motion the camera never travels: it cuts between rest poses. */
export function restIndexAt(rail: Rail, y: number): number {
  return locate(rail, y).current;
}

/**
 * The pose with reduced motion at scroll y: the current station's rest pose, or for a `follow`
 * station in its dwell, its camera right there (it jumps from step to step, never eases).
 */
export function reducedPoseAt(stations: readonly RailStation[], rail: Rail, y: number): { pose: CameraPose; index: number } {
  const p = locate(rail, y);
  const s = stations[p.current];
  if (s.follow && p.index === p.current && p.phase === "dwell") return { pose: stationPose(s, p.t), index: p.current };
  return { pose: restPose(s), index: p.current };
}

/** Fill each rail station's frame for scroll y (mutates `frames`, which modules hold on to). */
export function fillFrames(rail: Rail, y: number, frames: readonly StationFrame[]): void {
  const p = locate(rail, y);
  frames.forEach((f, i) => {
    if (i < p.index) {
      f.t = 1;
      f.arrive = 1;
    } else if (i > p.index) {
      f.t = 0;
      f.arrive = 0;
    } else if (p.phase === "travel") {
      f.t = 0;
      f.arrive = p.t;
    } else {
      f.t = p.t;
      f.arrive = 1;
    }
    f.current = i === p.current;
    f.near = Math.abs(i - p.current) <= (rail.reach[i] ?? 1) || i === p.index;
  });
}

/**
 * A camera through a list of stops, for a dwell: equal shares of t, eased with smootherstep inside
 * each share, so the camera settles at every stop on the way (the stops of a tour).
 */
export function through(...stops: CameraPose[]): (t: number) => CameraPose {
  if (stops.length === 0) throw new Error("world: through() needs at least one stop");
  if (stops.length === 1) return () => stops[0];
  const n = stops.length - 1;
  return (t) => {
    const u = clamp01(t) * n;
    const i = Math.min(n - 1, Math.floor(u));
    return mixPose(stops[i], stops[i + 1], smoother(u - i));
  };
}

/** Scroll px of a station's dwell start, for goTo(). */
export function dwellStart(rail: Rail, id: StationId): number | null {
  return rail.spans.find((s) => s.id === id)?.start ?? null;
}
