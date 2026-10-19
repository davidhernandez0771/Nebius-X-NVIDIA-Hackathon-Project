// Replay: a saved episode from the store (GET /twin/episodes/{id}, src/app/routers/twin.py), played back in real
// time. Pure, so the hook (useReplayTwin) only feeds it animation-frame times.
import { pose7 } from "./messages";
import type { QuatWxyz, TwinPose, TwinState, Vec3 } from "./types";

/** New poses at most this often (the episode has 50 a second; the twin doesn't need them all). */
export const REPLAY_HZ = 30;
/** After the last step the twin rests this long, the cube in the bin, before playing again. */
export const END_HOLD_S = 1.5;

export type Episode = {
  demoId: string;
  source: string;
  robot: string;
  fps: number;
  nSteps: number;
  jointNames: string[];
  jointPos: number[][];
  gripper: (0 | 1)[];
  /** The cube's recorded positions, or null if the episode has no signals. */
  cubePos: Vec3[] | null;
  /** The cube's start orientation, held (the sim records no cube rotation). */
  cubeQuat: QuatWxyz;
  bin: TwinPose;
  base: TwinPose;
  /** The sim's verification from the passport, or null without one. */
  verified: boolean | null;
  /** The human demo first, this copy last. */
  lineage: string[] | null;
};

export type EpisodeSummary = { id: string; source: string; robot: string; nSteps: number; fps: number; verified: boolean | null; lineage: string[] | null };

const fail = (what: string): never => {
  throw new Error(`the episode's ${what} doesn't read`);
};

export function parseEpisode(body: unknown): Episode {
  const b = (body ?? {}) as Record<string, unknown>;
  const n = typeof b.n_steps === "number" && b.n_steps > 0 ? b.n_steps : fail("n_steps");
  const names = Array.isArray(b.joint_names) ? (b.joint_names as string[]) : fail("joint_names");
  const q = Array.isArray(b.joint_pos) && b.joint_pos.length === n ? (b.joint_pos as number[][]) : fail("joint_pos");
  if (!q.every((row) => Array.isArray(row) && row.length === names.length)) fail("joint_pos");
  const grip = Array.isArray(b.gripper) && b.gripper.length === n ? (b.gripper as number[]) : fail("gripper");
  const cube = b.cube_pos === null ? null : Array.isArray(b.cube_pos) && b.cube_pos.length === n ? (b.cube_pos as Vec3[]) : fail("cube_pos");
  const bin = pose7(b.bin) ?? fail("bin");
  const base = pose7(b.base) ?? fail("base");
  const cq = Array.isArray(b.cube_quat) && b.cube_quat.length === 4 ? (b.cube_quat as QuatWxyz) : fail("cube_quat");
  return {
    demoId: String(b.demo_id),
    source: String(b.source),
    robot: String(b.robot),
    fps: typeof b.fps === "number" && b.fps > 0 ? b.fps : fail("fps"),
    nSteps: n,
    jointNames: names,
    jointPos: q,
    gripper: grip.map((g) => (g ? 1 : 0)),
    cubePos: cube,
    cubeQuat: cq,
    bin,
    base,
    verified: typeof b.verified === "boolean" ? b.verified : null,
    lineage: Array.isArray(b.lineage) ? (b.lineage as string[]) : null,
  };
}

export function parseSummaries(body: unknown): EpisodeSummary[] {
  if (!Array.isArray(body)) throw new Error("the list of episodes doesn't read");
  return body.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    source: String(r.source),
    robot: String(r.robot),
    nSteps: Number(r.n_steps),
    fps: Number(r.fps),
    verified: typeof r.verified === "boolean" ? r.verified : null,
    lineage: Array.isArray(r.lineage) ? (r.lineage as string[]) : null,
  }));
}

/** What the twin draws at one step. */
export function stateAt(ep: Episode, step: number): TwinState {
  const k = Math.max(0, Math.min(ep.nSteps - 1, Math.round(step)));
  const row = ep.jointPos[k];
  return {
    joints: Object.fromEntries(ep.jointNames.map((n, i) => [n, row[i]])),
    gripper: ep.gripper[k],
    cube: ep.cubePos ? { pos: ep.cubePos[k], quat: ep.cubeQuat } : null,
    bin: ep.bin,
  };
}

/**
 * Real-time playback, looped: advance(dt) moves the clock and returns the step to show, or null when nothing new
 * is due (the same step, or less than 1/REPLAY_HZ since the last one shown). The last step is always shown before
 * the hold, so a replay ends with the cube where it landed.
 */
export class ReplayClock {
  t = 0;
  private shown = -1;
  private shownAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly nSteps: number,
    readonly fps: number,
    readonly hz: number = REPLAY_HZ,
    readonly holdS: number = END_HOLD_S,
  ) {}

  get duration(): number {
    return this.nSteps / this.fps + this.holdS;
  }

  stepAt(t: number): number {
    return Math.min(this.nSteps - 1, Math.floor(t * this.fps));
  }

  advance(dt: number): number | null {
    this.t += Math.max(0, dt);
    if (this.t >= this.duration) {
      this.t %= this.duration;
      this.shownAt = Number.NEGATIVE_INFINITY;
    }
    const step = this.stepAt(this.t);
    if (step === this.shown) return null;
    const last = step === this.nSteps - 1;
    if (!last && this.t - this.shownAt < 1 / this.hz - 1e-9) return null;
    this.shown = step;
    this.shownAt = this.t;
    return step;
  }

  seek(step: number): number {
    const k = Math.max(0, Math.min(this.nSteps - 1, Math.round(step)));
    this.t = k / this.fps;
    this.shown = k;
    this.shownAt = this.t;
    return k;
  }
}
