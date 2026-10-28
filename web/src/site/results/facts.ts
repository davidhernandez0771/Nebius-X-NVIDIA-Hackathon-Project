// The Results page's wording, each fact with the note and lines it comes from. Every count, CI
// and p comes from ./results.json (read by ./data.ts); this file only names and phrases them.
//
// The confirmatory 40-scene numbers are used, never the pooled 4/60 vs 24/60, as
// docs/design/content-spec.md §4 ("Data note") says. The facts and wording follow the spec's fact
// registry (sprint 9: R1–R18, C1–C4, B1–B5, A2, Y3). facts.test.ts checks that the sentences here
// quote the same numbers as results.json. Line numbers are from the notes as of sprint 9; the
// notes are append-only.
import { RESULTS, experiment, formatP, isNote, measured, type NoteSource, type Source } from "./data";

export type { Source };

export const NOTES = RESULTS.notes;

const t2 = (lines: string): NoteSource => ({ note: "t2", lines });
const t3 = (lines: string): NoteSource => ({ note: "t3", lines });

export function cite(s: Source): string {
  if (!isNote(s)) return `Experiment store: ${s.file}`;
  const many = /[–,]/.test(s.lines);
  return `${NOTES[s.note].name}, ${many ? "lines" : "line"} ${s.lines}`;
}

export type Arm = {
  key: string;
  cell: string;
  copies: 0 | 100 | 300;
  label: string;
  k: number;
  n: number;
  count: Source;
  /** One character per scene, seed 5020 first: "1" success, "0" failure. */
  outcomes: string;
  outcomesSource: Source;
  ci: { text: string; source: Source };
  epochs: { text: string; source: Source };
  drops: { k: number; of: number; source: Source };
};

const one = (x: number) => (Math.round(x * 1000) / 10).toFixed(1);

/** The three policies of the multiply result, from results.json's "multiply" experiment. */
const CELLS = [
  { key: "raw", cell: "raw_10_30k", copies: 0 },
  { key: "x100", cell: "raw_multiply_10_30k", copies: 100 },
  { key: "x300", cell: "raw_multiply_10x30", copies: 300 },
] as const;

export const ARMS: Arm[] = CELLS.map(({ key, cell, copies }) => {
  const a = measured("multiply", cell);
  if (!a.ci || !a.outcomes || !a.outcomesSource || a.passes === null || !a.passesSource || !a.drops)
    throw new Error(`results.json's multiply.${cell} needs ci, outcomes, passes and drops`);
  return {
    key,
    cell,
    copies,
    label: a.label,
    k: a.k,
    n: a.n,
    count: a.source,
    outcomes: a.outcomes,
    outcomesSource: a.outcomesSource,
    ci: { text: `${one(a.ci[0])}–${one(a.ci[1])}%`, source: a.source },
    epochs: { text: `about ${a.passes}`, source: a.passesSource },
    drops: a.drops,
  };
});

const [RAW, X100, X300] = ARMS;

function comparison(a: Arm, b: Arm) {
  const c = experiment("multiply").groups[0].comparisons.find((x) => x.a === a.cell && x.b === b.cell);
  if (!c || c.p === null || !c.source) throw new Error(`results.json has no measured p for ${a.cell} vs ${b.cell}`);
  return { p: formatP(c.p), source: c.source };
}

/** Two-sided Fisher exact tests (T1's demo_pipeline.stats), as the notes print them. */
export const COMPARISONS = {
  rawVs100: comparison(RAW, X100),
  rawVs300: comparison(RAW, X300),
  x100Vs300: comparison(X100, X300),
};

const verified = (key: string) => {
  const a = measured("copies", key);
  return { k: a.k, n: a.n, source: a.source };
};

/** The copies themselves: every one passed the physics check before training. */
export const VERIFIED = { x100: verified("copies_10x10"), x300: verified("copies_10x30") };

/** The scenes: new, fixed before the run, never used to choose anything. */
export const SCENES = { seeds: experiment("multiply").seeds.match(/^\d+–\d+/)![0], source: t3("1112–1114, 1160–1161") };

/** The H1 (spec §4), T3's own sentence for the result (R14), and the replication in one sentence (R18). */
export const HEADLINE = {
  title: "Multiplying 10 demos made the robot better. Tripling the copies didn't help more.",
  text: "On 40 held-out home-start scenes, ACT trained on 10 demos + 100 multiplied variants succeeded 17/40 (43%, 95% CI 29–58%) vs 3/40 (8%, 3–20%) for the 10 demos alone (Fisher p < 0.001); one training run per cell, 30k steps each.",
  source: t3("1171–1173"),
  replicates: "A second, independently multiplied set of 300 copies scored 16/40 against the same 3/40 (p = 0.0012), so the effect replicates. The raw arm and the scenes are shared.",
  replicatesSource: t3("1313, 1318–1320"),
};

/** Said in the same viewport as every proof beat (spec wording rule 2). */
export const PROOF_SO_FAR = { text: "Scripted-expert source demos. The real webcam and mouse demos are further down.", source: t2("897") };

/** What the result does not show (C1–C4, A2). Shown next to it, never in a footnote only. */
export const LIMITS = [
  { text: "One task (a 5 cm cube into a bin), one simulated arm (Franka), one policy type (ACT), and one training run per arm.", sources: [t3("1165–1166")] },
  {
    text: "The 10 source demos came from a scripted expert and were already clean, so this tests multiplying, not perfecting. The real webcam and mouse demos are further down this page.",
    sources: [t2("897")],
  },
  { text: "Every policy got the same 30k training steps, so the ones with fewer examples saw each one more often.", sources: [t3("1167, 1257")] },
  { text: "It still drops the cube: 22 of 23 failures with 100 copies, 23 of 24 with 300.", sources: [t3("1176, 1325")] },
];

/** Why 300 copies didn't beat 100 here, in the note's own terms. */
export const PLATEAU = {
  text: "17/40 against 16/40 is no detectable difference, not proof of no effect: at 40 scenes, a gap like 42% to 60% would usually go unseen. And with equal training steps, the 300-copy policy saw each example about 1.6 times, against about 4.5 for the 100-copy one.",
  source: t3("1321–1323, 1257"),
};

type Measure = { k: number; n: number; what: string; ci?: string; also?: string; source: Source; alsoSource?: Source };

export type ReportCard = {
  key: "franka" | "openarm" | "flexiv" | "yours";
  robot: string;
  status: { label: string; tone: "live" | "issue" | "neutral" };
  summary: string;
  /** Copies of one source demo that passed the physics check, on the same 30 scenes for every arm. */
  copies: Measure | null;
  policy: Measure | null;
  /** Failure counts where the registry has them (R9), otherwise the registry's reason in words (B2, B3). */
  failures: { why: string; counts?: { label: string; k: number; of: number }[]; source: Source } | null;
  reach: { value: string; detail: string; source: Source } | null;
  /** Shown under "Pending" to say why a value is missing. */
  pendingNotes?: { policy?: string; reach?: string };
};

const SAME_SCENES = "copies that passed the physics check, on the same 30 scenes (seeds 100–129)";
const NO_POLICY = "No policy trained on it yet.";

const copies = (key: string, also?: { text: string; source: Source }): Measure => {
  const a = measured("copies", key);
  return { k: a.k, n: a.n, what: SAME_SCENES, also: also?.text, source: a.source, alsoSource: also?.source };
};
const FIRST = measured("copies", "franka_first");
const BYOR_FRANKA = measured("byor", "franka");
const BYOR_OPENARM = measured("byor", "openarm");
const upload = (a: { k: number; n: number; source: Source }) => ({ text: `${a.k}/${a.n} again through the bring-your-own-robot upload.`, source: a.source });

export const REPORT_CARDS: ReportCard[] = [
  {
    key: "franka",
    robot: "Franka Panda",
    status: { label: "Ready", tone: "live" },
    summary: "Our main robot. Every result on this page is on it.",
    copies: {
      ...copies("franka_fixed", { ...upload(BYOR_FRANKA), text: `${FIRST.k}/${FIRST.n} in the first run, before a fix to how copies are planned. ${upload(BYOR_FRANKA).text}` }),
      source: t2("513, 639–640"),
    },
    policy: {
      k: X100.k,
      n: X100.n,
      what: "new scenes completed by the policy trained on 10 demos + 100 copies",
      ci: X100.ci.text,
      also: `${X300.k}/${X300.n} with 300 copies (95% CI ${X300.ci.text}).`,
      source: t3("1156, 1307"),
    },
    failures: {
      why: "Picks the cube up, then drops it.",
      counts: [
        { label: "Policy with 100 copies", k: X100.drops.k, of: X100.drops.of },
        { label: "Policy with 300 copies", k: X300.drops.k, of: X300.drops.of },
      ],
      source: t3("1176, 1325"),
    },
    reach: null,
    pendingNotes: { reach: "No reach map measured yet." },
  },
  {
    key: "openarm",
    robot: "OpenArm",
    status: { label: "Design flaw found", tone: "issue" },
    summary: "Same source demo, same scenes. A design limit found in simulation, before anyone built a cell around it.",
    copies: copies("openarm", upload(BYOR_OPENARM)),
    policy: null,
    failures: { why: "The arm itself: it can't keep the gripper pointing down across the workspace.", source: t2("301–304, 528–529") },
    reach: { value: "±45° wrist", detail: "confines a vertical grasp to a ~0.2 m height band", source: t2("368") },
    pendingNotes: { policy: NO_POLICY },
  },
  {
    key: "flexiv",
    robot: "Flexiv Rizon 4s",
    status: { label: "Tested", tone: "neutral" },
    summary: "Same source demo, same scenes. The arm reaches; the gripper model is the problem.",
    copies: copies("flexiv"),
    policy: null,
    failures: { why: "The gripper model's near-massless fingers slip or drag the cube.", source: t2("529, 592") },
    reach: { value: "Fine", detail: "its failures are grip, not reach", source: t2("540") },
    pendingNotes: { policy: NO_POLICY },
  },
  {
    key: "yours",
    robot: "Your robot",
    status: { label: "Preview", tone: "neutral" },
    summary: "Upload a URDF, mark the base, the hand and the gripper, and run the same workflow to get this card.",
    copies: null,
    policy: null,
    failures: null,
    reach: null,
  },
];
