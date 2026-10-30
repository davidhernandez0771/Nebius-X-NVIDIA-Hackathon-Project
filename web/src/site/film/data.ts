// Everything the film shows, loaded once before the first frame. All of it is something Isaac recorded or a number in
// the README: web/public/film (video/build_film_data.py, video/build_timeline.py) and the test track's own replays.
import { parseEpisode, type Episode } from "../../twin/replay";
import type { Vec3 } from "../../twin/types";
import { fetchIndex, fetchRun } from "../testtrack/api";
import type { Source, TrackRun } from "../testtrack/model";
import type { Timeline } from "./model";

const ROOT = `${import.meta.env.BASE_URL ?? "/"}film/`;

/** A recorded demo: the twin's episode plus the hand's path and the contact force each step. */
export type Demo = Episode & { hand: Vec3[]; force: number[] };
export type Variant = { id: string; seed: number; success: boolean; scene: { cube_pose: { pos: Vec3 }; bin_pose: { pos: Vec3 } }; hand: Vec3[] };
export type ScenePlanFile = {
  text: string;
  model: string;
  calls: number;
  est_cost_usd: number;
  plan: { objects: { id: string; kind: string; color: string; size?: number; inner?: number[]; pose: { x: number; y: number } }[] };
};

export type FilmData = {
  timeline: Timeline;
  demos: Record<string, Demo>;
  /** demos.jpg's row order */
  demoRows: string[];
  variants: Variant[];
  plan: ScenePlanFile;
  final: Source;
  finalRuns: Record<string, TrackRun>;
  teacher: Source;
  teacherRuns: Record<string, TrackRun>;
};

async function json<T>(path: string): Promise<T> {
  const res = await fetch(ROOT + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** The teacher's runs the film plays. */
export const TEACHER_SEEDS = ["5350", "5351"];

export async function loadFilm(): Promise<FilmData> {
  const [timeline, demoRows, variants, plan, index] = await Promise.all([
    json<Timeline>("timeline.json"),
    json<string[]>("demos.json"),
    json<Variant[]>("variants.json"),
    json<ScenePlanFile>("scene_plan.json"),
    fetchIndex(),
  ]);
  const demos: Record<string, Demo> = {};
  await Promise.all(
    demoRows.map(async (id) => {
      const raw = await json<Record<string, unknown>>(`demos/${id}.json`);
      demos[id] = { ...parseEpisode(raw), hand: raw.hand_pos as Vec3[], force: raw.max_contact_n as number[] };
    }),
  );
  const final = index.sources.find((s) => s.id === "final-test-v2")!;
  const teacher = index.sources.find((s) => s.id === "teacher-gate")!;
  const finalRuns: Record<string, TrackRun> = {};
  const teacherRuns: Record<string, TrackRun> = {};
  await Promise.all([
    ...final.runs.map(async (r) => (finalRuns[r.id] = await fetchRun(r.file!))),
    ...teacher.runs.filter((r) => TEACHER_SEEDS.includes(r.id)).map(async (r) => (teacherRuns[r.id] = await fetchRun(r.file!))),
  ]);
  return { timeline, demos, demoRows, variants, plan, final, finalRuns, teacher, teacherRuns };
}

export const filmAsset = (name: string) => ROOT + name;
