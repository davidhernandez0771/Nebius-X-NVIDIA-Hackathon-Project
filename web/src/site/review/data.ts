// What the Review page shows: a raw demo, its perfected child (if any), the diagnosis that links them,
// and each side's physics verification and camera frames when they exist. It comes either from the
// backend (pmApi, as /pm/review uses it) or from the recorded example in ./example, exported unchanged
// from the local demo store by scripts/export_review_example.py.

import { pmApi } from "../../pm/api";
import type { Demo, StoredDiagnosis } from "../../pm/types";
import exampleJson from "./example/example.json";
import perfectedSprite from "./example/perfected_front.jpg";
import rawSprite from "./example/raw_front.jpg";
import type { VerificationLike } from "./model";

export interface FrameSheet {
  url: string;
  count: number;
  cols: number;
  w: number;
  h: number;
  /** The episode step of each frame; time = step / fps. */
  steps: number[];
  fps: number;
}

export interface Side {
  demo: Demo;
  verification: VerificationLike | null;
  frames: FrameSheet | null;
}

export interface Subject {
  raw: Side;
  perfected: Side | null;
  /** The diagnosis of the raw demo that the fixes came from. */
  stored: StoredDiagnosis | null;
  /** Another diagnoser's view of the same raw demo, when the store has one (the example: sprint 3 Nemotron). */
  secondOpinion: StoredDiagnosis | null;
  example: boolean;
}

export const EXAMPLE_ID = "example";

interface ExampleSide {
  demo: Demo;
  diagnosis: StoredDiagnosis | null;
  passport: { verification: VerificationLike };
  fps: number;
  frames: Omit<FrameSheet, "url" | "fps"> & { file: string };
}

const ex = exampleJson as unknown as { raw: ExampleSide; perfected: ExampleSide };

function exampleSide(s: ExampleSide, url: string): Side {
  const { file: _file, ...sheet } = s.frames;
  return { demo: s.demo, verification: s.passport.verification, frames: { ...sheet, url, fps: s.fps } };
}

export const exampleSubject: Subject = {
  raw: exampleSide(ex.raw, rawSprite),
  perfected: exampleSide(ex.perfected, perfectedSprite),
  // The perfected demo stores the rules diagnosis it was repaired from; the raw demo stores the sprint 3 Nemotron's.
  stored: ex.perfected.diagnosis,
  secondOpinion: ex.raw.diagnosis,
  example: true,
};

export const durationOf = (d: Demo) => {
  const t = d.trajectory.t;
  return t.length ? t[t.length - 1] - t[0] : 0;
};

/** A live demo: a repaired or variant one is shown against its parent; a human one on its own. */
export async function loadSubject(id: string): Promise<Subject> {
  const demo = await pmApi.getDemo(id);
  const side = (d: Demo): Side => ({ demo: d, verification: null, frames: null });
  if (demo.parent_id) {
    const parent = await pmApi.getDemo(demo.parent_id).catch(() => null);
    const [own, parents] = await Promise.all([pmApi.getDiagnosis(demo.id), parent ? pmApi.getDiagnosis(parent.id) : null]);
    if (parent) return { raw: side(parent), perfected: side(demo), stored: own ?? parents, secondOpinion: null, example: false };
  }
  return { raw: side(demo), perfected: null, stored: await pmApi.getDiagnosis(demo.id), secondOpinion: null, example: false };
}
