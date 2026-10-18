// Reading the report card (byor-api.md §6): failure reasons, the reach map, the run's progress, and the one rule
// this page adds on top of the card, "design flaw found".
import type { Issue, Parts, ReportCard, ReportResponse } from "./types";

const REASON_LABEL: Record<string, string> = {
  unreachable: "Couldn't follow the path",
  collision: "Hit the table or the bin",
  not_in_bin: "Cube missed the bin",
  dropped: "Dropped the cube",
  not_settled: "Cube still moving at the end",
  sim_error: "The simulator failed",
};

export type Reason = { code: string; label: string; count: number };

export function reasons(report: ReportCard): Reason[] {
  return Object.entries(report.pick_place.failure_reasons.value)
    .map(([code, count]) => ({ code, label: REASON_LABEL[code] ?? code.replace(/_/g, " "), count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export type ReachCell = { x: number; y: number; count: number; layers: boolean[] };

/** grid[x][y]: how many of the task's tool poses (layers) reach that cell. */
export function reachCells(report: ReportCard): ReachCell[][] {
  const { grid, layers } = report.reach_map;
  return grid.x.map((x, i) =>
    grid.y.map((y, j) => {
      const hit = layers.map((l) => Boolean(l.reachable[i]?.[j]));
      return { x, y, count: hit.filter(Boolean).length, layers: hit };
    }),
  );
}

export function layerLabel(l: { name: string; yaw_deg: number }): string {
  if (l.name === "grasp") return `Grasp, wrist ${l.yaw_deg > 0 ? "+" : l.yaw_deg < 0 ? "−" : ""}${Math.abs(l.yaw_deg)}°`;
  if (l.name === "release") return "Release over the bin";
  if (l.name === "carry") return "Carry height";
  return l.name;
}

export type JointLimits = { joint: string; sides: ("lower" | "upper")[]; scenes: number; steps: number };

const sceneCounts = (report: ReportCard) => {
  const scenes = new Map<string, number>();
  for (const r of report.scenes.rows) for (const j of new Set(r.limit_hits.map((h) => h.split(":")[0]))) scenes.set(j, (scenes.get(j) ?? 0) + 1);
  return scenes;
};

/** One row per arm joint that reached a limit: which sides, in how many scenes (counted once), and for how many steps. */
export function limitsByJoint(report: ReportCard): JointLimits[] {
  const scenes = sceneCounts(report);
  const by = new Map<string, JointLimits>();
  for (const h of report.joint_limit_hits.value) {
    const row = by.get(h.joint) ?? { joint: h.joint, sides: [], scenes: scenes.get(h.joint) ?? h.scenes, steps: 0 };
    row.sides.push(h.limit);
    row.steps += h.steps;
    by.set(h.joint, row);
  }
  return [...by.values()].sort((a, b) => b.scenes - a.scenes || b.steps - a.steps);
}

/** The small-multiple caption: "Grasp −45°", "Release", "Carry". */
export function layerShort(l: { name: string; yaw_deg: number }): string {
  if (l.name === "grasp") return `Grasp ${l.yaw_deg > 0 ? "+" : l.yaw_deg < 0 ? "−" : ""}${Math.abs(l.yaw_deg)}°`;
  return l.name.charAt(0).toUpperCase() + l.name.slice(1);
}

export type DesignFlaw = {
  joint: string;
  /** 1-based position in the arm, from the base. */
  index: number;
  of: number;
  lowerDeg: number;
  upperDeg: number;
  /** Scenes in which it sat at a limit. */
  scenes: number;
  n: number;
  unreachable: number;
  reach: number;
};

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/**
 * "Design flaw found": for a robot that is not ready, the arm joint with the narrowest range among those that sat
 * at a limit in at least 20% of the scenes. On the OpenArm this is joint 6 (±45°), the root cause T2 found by hand
 * (docs/superpowers/notes/2026-10-15-t2-status.md, "Root cause of the low yield").
 */
export function designFlaw(report: ReportCard, parts: Parts): DesignFlaw | null {
  if (report.verdict.value === "ready") return null;
  const rows = report.scenes.rows;
  const n = rows.length;
  const scenes = new Map<string, number>();
  for (const r of rows) for (const j of new Set(r.limit_hits.map((h) => h.split(":")[0]))) scenes.set(j, (scenes.get(j) ?? 0) + 1);
  const arm = report.roles.arm_joints;
  const min = Math.max(2, Math.ceil(0.2 * n));
  const candidates = arm
    .map((name) => ({ name, j: parts.joints.find((x) => x.name === name), s: scenes.get(name) ?? 0 }))
    .filter((c) => c.j?.limits && c.s >= min)
    .sort((a, b) => a.j!.limits!.upper - a.j!.limits!.lower - (b.j!.limits!.upper - b.j!.limits!.lower) || b.s - a.s);
  const top = candidates[0];
  if (!top) return null;
  return {
    joint: top.name,
    index: arm.indexOf(top.name) + 1,
    of: arm.length,
    lowerDeg: deg(top.j!.limits!.lower),
    upperDeg: deg(top.j!.limits!.upper),
    scenes: top.s,
    n,
    unreachable: report.pick_place.failure_reasons.value.unreachable ?? 0,
    reach: report.reach_map.fraction.value,
  };
}

export function verdictLabel(v: ReportCard["verdict"]["value"]): string {
  return v === "ready" ? "Ready" : v === "partial" ? "Partly works" : "Not ready";
}

const BLOCKED: Record<string, string> = {
  sim_busy: "The simulator is busy with another run: only one Isaac process runs at a time. Try again when it finishes.",
  roles_missing: "Save the roles first.",
  roles_invalid: "The saved roles no longer check out. Fix the problems on the roles and run again.",
};

/** The 409s from POST /evaluate (byor-api.md §5), in plain words; null for anything else. */
export function runBlocked(errors: Issue[]): string | null {
  for (const e of errors) if (BLOCKED[e.code]) return BLOCKED[e.code];
  return null;
}

type Progress = ReportResponse["progress"];

export function stageLabel(p: NonNullable<Progress>): string {
  if (p.stage === "convert") return "Converting the URDF for Isaac Sim";
  if (p.stage === "reach_map") return "Mapping where the tool can reach";
  if (p.done >= p.total) return "Pick and place: writing the card";
  return `Pick and place: scene ${p.done + 1} of ${p.total}`;
}

const WEIGHT = { convert: [0, 0.1], reach_map: [0.1, 0.1], pick_place: [0.2, 0.8] } as const;

export function overallProgress(p: Progress): number {
  if (!p) return 0;
  const [start, span] = WEIGHT[p.stage];
  return start + span * (p.total ? Math.min(1, p.done / p.total) : 0);
}
