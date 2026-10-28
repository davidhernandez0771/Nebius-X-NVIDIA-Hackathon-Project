// What the Review page shows: a raw demo, its perfected child (if any), the diagnosis that links them,
// each side's physics verification and camera frames when they exist, the fixes Neaten applied and
// Nemotron's verdict. It comes either from the backend (pmApi, GET /demos/{id}/review for the card) or
// from the recorded example in ./example, exported unchanged from the local demo store by
// scripts/export_review_example.py, with the verdict from scripts/export_review_verdict.py.

import { pmApi } from "../../pm/api";
import type { Demo, DemoReview, RepairOp, ReviewVerdict, StoredDiagnosis } from "../../pm/types";
import exampleJson from "./example/example.json";
import exampleVerdictJson from "./example/verdict.json";
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

/** The fixes Neaten applied, from the shown demo's passport (repairs_applied, times in demo seconds). */
export interface AppliedFixes {
  applied: RepairOp[];
  /** The repaired demo the fixes were applied to, and when (its created_at). */
  appliedTo: string | null;
  appliedAt: string | null;
  diagnosisSource: string | null;
  modelId: string | null;
}

export interface CardVerdict {
  verdict: ReviewVerdict;
  /** The copy the match was judged on, when it isn't the shown demo itself. */
  judgedOn: string | null;
  source: string;
}

export interface Subject {
  raw: Side;
  perfected: Side | null;
  /** The diagnosis of the raw demo that the fixes came from. */
  stored: StoredDiagnosis | null;
  /** Another diagnoser's view of the same raw demo, when the store has one (the example: sprint 3 Nemotron). */
  secondOpinion: StoredDiagnosis | null;
  /** Nemotron's label and match, when they were made; null is "not yet", never "no". */
  verdict: CardVerdict | null;
  fixes: AppliedFixes | null;
  /** Where the shown demo's physics came from (passport, episode_passport, success_check), and why it's unknown. */
  physicsSource: string | null;
  physicsDetail: string | null;
  warnings: string[];
  example: boolean;
}

export const EXAMPLE_ID = "example";

interface ExampleSide {
  demo: Demo;
  diagnosis: StoredDiagnosis | null;
  passport: { verification: VerificationLike; repairs_applied: RepairOp[]; diagnosis_source: string; model_id: string | null };
  fps: number;
  frames: Omit<FrameSheet, "url" | "fps"> & { file: string };
}

const ex = exampleJson as unknown as { raw: ExampleSide; perfected: ExampleSide };
const exVerdict = exampleVerdictJson as unknown as { copy_id: string; verdict: ReviewVerdict };

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
  // Real replies from the 2026-10-18 labeler/judge test: the label of s1_0002's recording, the match of a copy.
  verdict: { verdict: exVerdict.verdict, judgedOn: exVerdict.copy_id, source: "the 2026-10-18 labeler/judge test" },
  fixes: {
    applied: ex.perfected.passport.repairs_applied,
    appliedTo: ex.perfected.demo.id,
    appliedAt: ex.perfected.demo.created_at,
    diagnosisSource: ex.perfected.passport.diagnosis_source,
    modelId: ex.perfected.passport.model_id,
  },
  physicsSource: "passport",
  physicsDetail: null,
  warnings: [],
  example: true,
};

export const durationOf = (d: Demo) => {
  const t = d.trajectory.t;
  return t.length ? t[t.length - 1] - t[0] : 0;
};

/** The review route's physics as a verification, when it has one. */
export function verificationOf(r: DemoReview | null): VerificationLike | null {
  const p = r?.physics;
  if (!p || p.status === "unknown" || p.duration == null || p.path_length == null) return null;
  return { success: p.status === "verified", reasons: p.reasons, duration: p.duration, path_length: p.path_length };
}

/** The card's parts of the shown demo's review: its verdict, fixes and where its physics came from. */
export function cardOf(r: DemoReview | null): Pick<Subject, "verdict" | "fixes" | "physicsSource" | "physicsDetail" | "warnings"> {
  if (!r) return { verdict: null, fixes: null, physicsSource: null, physicsDetail: "this backend has no review route", warnings: [] };
  const f = r.fixes;
  return {
    verdict: r.verdict ? { verdict: r.verdict, judgedOn: null, source: r.verdict_source ?? "review_verdict.json" } : null,
    fixes: f.source
      ? { applied: f.applied, appliedTo: f.applied_to, appliedAt: f.applied_at, diagnosisSource: f.diagnosis_source, modelId: f.model_id }
      : null,
    physicsSource: r.physics.source,
    physicsDetail: r.physics.detail,
    warnings: r.warnings,
  };
}

/** A live demo: a repaired or variant one is shown against its parent; a human one on its own. */
export async function loadSubject(id: string): Promise<Subject> {
  const demo = await pmApi.getDemo(id);
  const side = (d: Demo, r: DemoReview | null): Side => ({ demo: d, verification: verificationOf(r), frames: null });
  if (demo.parent_id) {
    const parent = await pmApi.getDemo(demo.parent_id).catch(() => null);
    const [own, parents, review, parentReview] = await Promise.all([
      pmApi.getDiagnosis(demo.id),
      parent ? pmApi.getDiagnosis(parent.id) : null,
      pmApi.getReview(demo.id),
      parent ? pmApi.getReview(parent.id) : null,
    ]);
    if (parent)
      return {
        raw: side(parent, parentReview),
        perfected: side(demo, review),
        stored: own ?? parents,
        secondOpinion: null,
        ...cardOf(review),
        example: false,
      };
  }
  const [stored, review] = await Promise.all([pmApi.getDiagnosis(demo.id), pmApi.getReview(demo.id)]);
  return { raw: side(demo, review), perfected: null, stored, secondOpinion: null, ...cardOf(review), example: false };
}
