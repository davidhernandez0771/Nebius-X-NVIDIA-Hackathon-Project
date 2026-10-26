// The proof band on the Results page: the pre-registered results of the Franka cube-in-bin task in Isaac Lab, where a
// camera policy (ACT) is tested once on 40 fresh scenes. Every number here is copied from two append-only notes, at
// the lines cited next to it (both on pm/live-13; line numbers as of 2b34b1b):
// - docs/superpowers/notes/2026-10-23-bigtest-prereg.md: v2's one-shot test (30/40), its failures, the held-human
//   re-execution (0/110) and DAgger's Stage B drop;
// - docs/superpowers/notes/2026-10-21-distill-prereg.md: v1's final test (15/40), the mouse raw and SANT arms
//   (0/40, 3/40), the teacher's speed gate (3/50, then 50/50) and Amendment 6, with and without human demo starts.
// Wilson 95% bounds are as the notes print them (3 places); proofData.test.ts checks each against stats.ts's wilson().
// Nothing on the page computes a number: it formats these.
import { REPO_BLOB } from "./data";

export const PROOF_NOTES = {
  bigtest: { name: "Big-test pre-registration note", path: "docs/superpowers/notes/2026-10-23-bigtest-prereg.md" },
  distill: { name: "Distill pre-registration note", path: "docs/superpowers/notes/2026-10-21-distill-prereg.md" },
} as const;

export type ProofNote = keyof typeof PROOF_NOTES;
export type ProofSource = { note: ProofNote; lines: string };

/** "Big-test pre-registration note, lines 742–751", as the page's other citations read. */
export function proofCite(s: ProofSource): string {
  const many = /[–,]/.test(s.lines);
  return `${PROOF_NOTES[s.note].name}, ${many ? "lines" : "line"} ${s.lines}`;
}

/** The note on GitHub, at the first range cited. */
export function proofNoteUrl(s: ProofSource): string {
  const [a, b] = s.lines.split(",")[0].trim().split("–");
  return `${REPO_BLOB}/${PROOF_NOTES[s.note].path}#L${a}${b ? `-L${b}` : ""}`;
}

/** k successes of n, with the Wilson 95% interval (0..1) the note prints. */
export type Rate = { k: number; n: number; ci: [number, number] };

// ------------------------------------------------------------------ 1. the climb

export type ClimbStep = Rate & {
  key: "raw" | "sant" | "v1" | "v2";
  /** A short mono tag for the row. */
  tag: string;
  label: string;
  seeds: string;
  source: ProofSource;
};

export const CLIMB: ClimbStep[] = [
  {
    key: "raw",
    tag: "Raw",
    label: "Raw human mouse demos",
    k: 0,
    n: 40,
    ci: [0.0, 0.088],
    seeds: "5020–5059",
    source: { note: "distill", lines: "1391" },
  },
  {
    key: "sant",
    tag: "SANT",
    label: "SANT-perfected + multiplied demos",
    k: 3,
    n: 40,
    ci: [0.026, 0.199],
    seeds: "5020–5059",
    source: { note: "distill", lines: "1390" },
  },
  {
    key: "v1",
    tag: "v1",
    label: "RL teacher distilled into the camera policy",
    k: 15,
    n: 40,
    ci: [0.242, 0.53],
    seeds: "5020–5059",
    source: { note: "distill", lines: "1386" },
  },
  {
    key: "v2",
    tag: "v2",
    label: "Same data, trained 3× longer (180k steps) + a gripper deadband",
    k: 30,
    n: 40,
    ci: [0.598, 0.858],
    seeds: "5400–5439",
    source: { note: "bigtest", lines: "744, 757–758" },
  },
];

/** The pre-registered goal for v2: at least 24/40. */
export const GOAL = { k: 24, n: 40, source: { note: "bigtest", lines: "745" } as ProofSource };

// ------------------------------------------------------------------ the lead (the page's headline)

const V2 = CLIMB.find((s) => s.key === "v2")!;
const DEMOS = 10;

/**
 * What the page leads with (site-nav, 2026-10-26): the human demos the whole climb starts from (the distill
 * pre-registration's "Few human demos: the 10 mouse demos.") and v2's one-shot result, from the climb above.
 */
export const LEAD = {
  demos: DEMOS,
  demosSource: { note: "distill", lines: "9" } as ProofSource,
  result: V2,
  goal: GOAL,
  headline: `${DEMOS} human mouse demos → ${V2.k}/${V2.n} (${Math.round((100 * V2.k) / V2.n)}%) on unseen scenes`,
};

export const CLIMB_FOOTNOTE =
  "Each bar is its own pre-registered test, run once. v2 was tested on fresh seeds 5400–5439; the others on 5020–5059, so the comparisons are descriptive.";
export const CLIMB_FOOTNOTE_SOURCE: ProofSource = { note: "bigtest", lines: "765" };

// ------------------------------------------------------------------ 2. the teacher side

export type CurvePoint = { iteration: number; withDemos: number; withoutDemos: number };

/** Home-start success out of 128, by RL training iteration (Amendment 6), with and without human demo starts. */
export const TEACHER = {
  n: 128,
  curve: [
    { iteration: 300, withDemos: 0, withoutDemos: 0 },
    { iteration: 600, withDemos: 10, withoutDemos: 0 },
    { iteration: 900, withDemos: 99, withoutDemos: 0 },
    { iteration: 1200, withDemos: 109, withoutDemos: 0 },
    { iteration: 1499, withDemos: 113, withoutDemos: 0 },
  ] as CurvePoint[],
  final: {
    withDemos: { k: 113, n: 128, ci: [0.816, 0.928] } as Rate,
    withoutDemos: { k: 0, n: 128, ci: [0.0, 0.029] } as Rate,
  },
  caption: "Same code, budget and seed; one run per arm.",
  source: { note: "distill", lines: "1653–1657" } as ProofSource,
  finalSource: { note: "distill", lines: "1621–1622" } as ProofSource,
  setupSource: { note: "distill", lines: "1500–1503" } as ProofSource,
};

// ------------------------------------------------------------------ 3. why v2's failures failed

export type FailureReason = { key: "dropped" | "not_in_bin" | "collision" | "gripper_closed"; label: string; count: number };

export const V2_FAILURES = {
  /** 40 − 30. */
  total: 10,
  /** All 10 ran out the time limit. */
  timedOut: 10,
  timeLimitS: 30,
  reasons: [
    { key: "dropped", label: "Dropped the cube", count: 10 },
    { key: "not_in_bin", label: "Not in the bin", count: 9 },
    { key: "collision", label: "Collision", count: 5 },
    { key: "gripper_closed", label: "Gripper closed", count: 2 },
  ] as FailureReason[],
  failedSeeds: [5400, 5402, 5408, 5409, 5413, 5421, 5427, 5433, 5437, 5439],
  source: { note: "bigtest", lines: "751–752" } as ProofSource,
  timeLimitSource: { note: "bigtest", lines: "61" } as ProofSource,
};

// ------------------------------------------------------------------ 4. what didn't work

export type Setback = { key: string; figure: string; title: string; text: string; sources: ProofSource[] };

export const DID_NOT_WORK: Setback[] = [
  {
    key: "held_human",
    figure: "0/110",
    title: "Human demos through the student's slow arm",
    text: "Replaying human demos through the student's slow arm controller: 0/110 passed. So v2 kept v1's original human set.",
    sources: [
      { note: "bigtest", lines: "349–350" },
      { note: "bigtest", lines: "759" },
    ],
  },
  {
    key: "dagger",
    figure: "7–8/29",
    title: "A DAgger correction round",
    text: "Its post-restart checkpoints dropped to 7–8/29 on practice seeds, for an unknown reason, so it lost the pre-registered pick.",
    sources: [{ note: "bigtest", lines: "716–727" }],
  },
  {
    key: "fast_teacher",
    figure: "3/50",
    title: "The first teacher was too fast",
    text: "It moved at an unrealistic 1.7 m/s, so SANT's physics replay caught it (3/50). A 0.5 m/s cap fixed it (50/50).",
    sources: [
      { note: "distill", lines: "440, 451" },
      { note: "distill", lines: "495, 551" },
    ],
  },
];
