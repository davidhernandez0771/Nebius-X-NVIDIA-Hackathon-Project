// Every number on the Results page, each with the note and lines it comes from.
//
// Why static: results.json (GET /results) holds the pooled 4/60 vs 24/60 for the 30k pair and
// has no 300-copy cell, so the confirmatory 40-scene numbers live here, cited, as
// docs/design/content-spec.md §4 ("Data note") says. Nothing is derived from pooled counts.
// The facts and wording follow the spec's fact registry (sprint 9: R1–R18, C1–C4, B1–B5, A2, Y3).
// facts.test.ts checks that the outcome strings add up to k and that every printed CI is the
// Wilson CI of k/n. Line numbers are from the notes as of sprint 9; the notes are append-only.

export const NOTES = {
  t2: { name: "T2 status note", path: "docs/superpowers/notes/2026-10-15-t2-status.md" },
  t3: { name: "T3 status note", path: "docs/superpowers/notes/2026-10-15-t3-status.md" },
  web: { name: "Web pages note", path: "docs/superpowers/notes/2026-10-16-web-pages.md" },
} as const;

export type Source = { note: keyof typeof NOTES; lines: string };

const t2 = (lines: string): Source => ({ note: "t2", lines });
const t3 = (lines: string): Source => ({ note: "t3", lines });
const web = (lines: string): Source => ({ note: "web", lines });

export function cite(s: Source): string {
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

export const ARMS: Arm[] = [
  {
    key: "raw",
    cell: "raw_10_30k",
    copies: 0,
    label: "The 10 demos alone",
    k: 3,
    n: 40,
    count: t3("1156"),
    outcomes: "0000000000001000000000000000000000010001",
    outcomesSource: t3("1369"),
    ci: { text: "2.6–19.9%", source: t3("1156") },
    epochs: { text: "about 49", source: t3("1167") },
    drops: { k: 15, of: 37, source: t3("1179") },
  },
  {
    key: "x100",
    cell: "raw_multiply_10_30k",
    copies: 100,
    label: "+ 100 verified copies",
    k: 17,
    n: 40,
    count: t3("1156"),
    outcomes: "0010100110110010010101001011001111000000",
    outcomesSource: t3("1370"),
    ci: { text: "28.5–57.8%", source: t3("1156") },
    epochs: { text: "about 4.5", source: t3("1167") },
    drops: { k: 22, of: 23, source: t3("1176") },
  },
  {
    key: "x300",
    cell: "raw_multiply_10x30",
    copies: 300,
    label: "+ 300 verified copies",
    k: 16,
    n: 40,
    count: t3("1307"),
    outcomes: "0100110100110000100001100101010100111000",
    outcomesSource: t3("1371"),
    ci: { text: "26.3–55.4%", source: t3("1307") },
    epochs: { text: "about 1.6", source: t3("1257") },
    drops: { k: 23, of: 24, source: t3("1325") },
  },
];

/** Two-sided Fisher exact tests (T1's demo_pipeline.stats), as the notes print them. */
export const COMPARISONS = {
  rawVs100: { p: "0.0005", source: t3("1131, 1156") },
  rawVs300: { p: "0.0012", source: t3("1313") },
  x100Vs300: { p: "1.0", source: t3("1314") },
};

/** The copies themselves: every one passed the physics check before training. */
export const VERIFIED = {
  x100: { k: 100, n: 100, source: t2("892, 898") },
  x300: { k: 300, n: 300, source: t2("1109, 1119") },
};

/** The scenes: new, fixed before the run, never used to choose anything. */
export const SCENES = { seeds: "5020–5059", source: t3("1112–1114, 1160–1161") };

/** The H1 (spec §4), T3's own sentence for the result (R14), and the replication in one sentence (R18). */
export const HEADLINE = {
  title: "Multiplying 10 demos made the robot better. Tripling the copies didn't help more.",
  text: "On 40 held-out home-start scenes, ACT trained on 10 demos + 100 multiplied variants succeeded 17/40 (43%, 95% CI 28–58%) vs 3/40 (8%, 3–20%) for the 10 demos alone (Fisher p < 0.001); one training run per cell, 30k steps each.",
  source: t3("1171–1173"),
  replicates: "A second, independently multiplied set of 300 copies scored 16/40 against the same 3/40 (p = 0.0012), so the effect replicates. The raw arm and the scenes are shared.",
  replicatesSource: t3("1313, 1318–1320"),
};

/** Said in the same viewport as every proof beat (spec wording rule 2). */
export const PROOF_SO_FAR = { text: "Scripted-expert source demos; human demos come next.", source: t2("897") };

/** What the result does not show (C1–C4, A2). Shown next to it, never in a footnote only. */
export const LIMITS = [
  { text: "One task (a 5 cm cube into a bin), one simulated arm (Franka), one policy type (ACT), and one training run per arm.", sources: [t3("1165–1166")] },
  {
    text: "The 10 source demos came from a scripted expert and were already clean, so this tests multiplying, not perfecting. No real person's demo has been recorded and verified yet.",
    sources: [t2("897"), web("436")],
  },
  { text: "Every policy got the same 30k training steps, so the ones with fewer examples saw each one more often.", sources: [t3("1167, 1257")] },
  { text: "It still drops the cube: 22 of 23 failures with 100 copies, 23 of 24 with 300.", sources: [t3("1176, 1325")] },
];

/** Why 300 copies didn't beat 100 here, in the note's own terms. */
export const PLATEAU = {
  text: "17/40 against 16/40 is no detectable difference, not proof of no effect: at 40 scenes, a gap like 42% to 60% would usually go unseen. And with equal training steps, the 300-copy policy saw each example about 1.6 times, against about 4.5 for the 100-copy one.",
  source: t3("1321–1323, 1257"),
};

type Measure = { k: number; n: number; what: string; ci?: string; also?: string; source: Source };

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

export const REPORT_CARDS: ReportCard[] = [
  {
    key: "franka",
    robot: "Franka Panda",
    status: { label: "Ready", tone: "live" },
    summary: "Our main robot. Every result on this page is on it.",
    copies: { k: 27, n: 30, what: SAME_SCENES, also: "30/30 after a later fix to how copies are planned.", source: t2("513, 639–640") },
    policy: {
      k: 17,
      n: 40,
      what: "new scenes completed by the policy trained on 10 demos + 100 copies",
      ci: "28.5–57.8%",
      also: "16/40 with 300 copies (95% CI 26.3–55.4%).",
      source: t3("1156, 1307"),
    },
    failures: {
      why: "Picks the cube up, then drops it.",
      counts: [
        { label: "Policy with 100 copies", k: 22, of: 23 },
        { label: "Policy with 300 copies", k: 23, of: 24 },
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
    copies: { k: 0, n: 30, what: SAME_SCENES, source: t2("310–311, 513") },
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
    copies: { k: 9, n: 30, what: SAME_SCENES, source: t2("513, 592") },
    policy: null,
    failures: { why: "The gripper model's near-massless fingers slip or drag the cube.", source: t2("529, 592") },
    reach: { value: "Fine", detail: "its failures are grip, not reach", source: t2("540") },
    pendingNotes: { policy: NO_POLICY },
  },
  {
    key: "yours",
    robot: "Your robot",
    status: { label: "Preview", tone: "neutral" },
    summary: "Coming next: upload a URDF, mark the base, the hand and the gripper, and run the same workflow to get this card.",
    copies: null,
    policy: null,
    failures: null,
    reach: null,
  },
];
