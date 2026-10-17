// Geometry for the Review page's demo strip: every segment, issue and repair
// as a left/width percentage of the demo's duration.

import type { Diagnosis, Trajectory } from "../types";

export interface Span {
  left: number; // % of the strip
  width: number; // %, 0 for a point in time
}

export interface Layout {
  segments: (Span & { name: string })[];
  issues: (Span & { type: string; evidence: string })[];
  repairs: (Span & { op: string })[];
  wholeDemo: string[]; // repairs with no time, e.g. discard
}

function span(duration: number, t0: number, t1: number): Span {
  if (!(duration > 0)) return { left: 0, width: 0 };
  const pct = (t: number) => (Math.min(Math.max(t, 0), duration) / duration) * 100;
  const left = pct(t0);
  return { left, width: pct(t1) - left };
}

function when(item: { t?: number | null; t0?: number | null; t1?: number | null }): [number, number] | null {
  if (item.t0 != null && item.t1 != null) return [item.t0, item.t1];
  if (item.t != null) return [item.t, item.t];
  return null;
}

export function layoutTimeline(duration: number, diagnosis: Diagnosis): Layout {
  const layout: Layout = { segments: [], issues: [], repairs: [], wholeDemo: [] };
  for (const s of diagnosis.segments) layout.segments.push({ name: s.name, ...span(duration, s.t0, s.t1) });
  for (const i of diagnosis.issues) {
    const w = when(i);
    if (w) layout.issues.push({ type: i.type, evidence: i.evidence, ...span(duration, ...w) });
  }
  for (const r of diagnosis.repairs) {
    const w = when(r);
    if (w) layout.repairs.push({ op: r.op, ...span(duration, ...w) });
    else layout.wholeDemo.push(r.op);
  }
  return layout;
}

export interface SpeedProfile {
  t: number[]; // end time of each step
  speed: number[]; // m/s over that step
  pathLength: number; // m
  duration: number; // s
}

export function speedProfile(traj: Pick<Trajectory, "t" | "ee_pos">): SpeedProfile {
  const t: number[] = [];
  const speed: number[] = [];
  let pathLength = 0;
  for (let i = 1; i < traj.t.length; i++) {
    const [ax, ay, az] = traj.ee_pos[i - 1];
    const [bx, by, bz] = traj.ee_pos[i];
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    pathLength += d;
    t.push(traj.t[i]);
    speed.push(d / (traj.t[i] - traj.t[i - 1]));
  }
  const duration = traj.t.length ? traj.t[traj.t.length - 1] - traj.t[0] : 0;
  return { t, speed, pathLength, duration };
}
