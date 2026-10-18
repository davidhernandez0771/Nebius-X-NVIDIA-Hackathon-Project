// Every number on the Results page, each with the note and lines it comes from.
//
// Why static: results.json (GET /results) holds the pooled 4/60 vs 24/60 for the 30k pair and
// has no 300-copy cell, so the confirmatory 40-scene numbers live here, cited, as
// docs/design/content-spec.md §4 ("Data note", option b) says. Nothing is derived from pooled
// counts. facts.test.ts checks that the outcome strings add up to k and that every printed CI is
// the Wilson CI of k/n. Line numbers are from the notes as of sprint 9; the notes are append-only.

export const NOTES = {
  t2: "docs/superpowers/notes/2026-10-15-t2-status.md",
  t3: "docs/superpowers/notes/2026-10-15-t3-status.md",
} as const;

export type Source = { note: keyof typeof NOTES; lines: string };

const t2 = (lines: string): Source => ({ note: "t2", lines });
const t3 = (lines: string): Source => ({ note: "t3", lines });

export function cite(s: Source): string {
  const many = /[–,]/.test(s.lines);
  return `${s.note.toUpperCase()} status note, ${many ? "lines" : "line"} ${s.lines}`;
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

/** T3's own sentence for the headline result. */
export const HEADLINE = {
  text: "On 40 held-out home-start scenes, ACT trained on 10 demos + 100 multiplied variants succeeded 17/40 (43%, 95% CI 28–58%) vs 3/40 (8%, 3–20%) for the 10 demos alone (Fisher p < 0.001); one training run per cell, 30k steps each.",
  source: t3("1171–1173"),
};

/** What the result does not show. Shown next to it, never in a footnote only. */
export const LIMITS = [
  { text: "One task (a cube into a bin), one simulated arm, one policy type (ACT), and one training run per arm.", source: t3("1165–1166") },
  { text: "The 10 source demos came from a scripted expert, not a person, and were already clean. This tests multiplying, not perfecting.", source: t2("897") },
  { text: "Every policy got the same 30k training steps, so the ones with fewer examples saw each one more often.", source: t3("1167, 1257") },
  { text: "The multiplied policy still drops the cube: that's 22 of its 23 failures.", source: t3("1176") },
];

/** Why 300 copies didn't beat 100 here, in the note's own terms. */
export const PLATEAU = {
  text: "17/40 against 16/40 is no detectable difference, not proof of no effect: at 40 scenes, a gap like 42% to 60% would usually go unseen. And with equal training steps, the 300-copy policy saw each example about 1.6 times, against about 4.5 for the 100-copy one.",
  source: t3("1321–1323, 1257"),
};

type Measure = { k: number; n: number; what: string; ci?: string; later?: string; source: Source };

export type ReportCard = {
  key: "franka" | "openarm" | "yours";
  robot: string;
  status: { label: string; tone: "live" | "issue" | "neutral" };
  summary: string;
  /** Copies of one source demo that passed the physics check: the same 30 scenes for every arm. */
  copies: Measure | null;
  policy: Measure | null;
  /** Why there is no policy, when that is known; otherwise a missing policy is "Pending". */
  policyNote?: string;
  failures: { what: string; of: number; reasons: { label: string; k: number }[]; overlap: boolean; source: Source } | null;
  reach: { value: string; detail: string; source: Source } | null;
};

const SAME_SCENES = "copies that passed the physics check, on the same 30 scenes (seeds 100–129)";

export const REPORT_CARDS: ReportCard[] = [
  {
    key: "franka",
    robot: "Franka Panda",
    status: { label: "Tested", tone: "live" },
    summary: "Our main arm, and the one every policy on this page was trained for.",
    copies: { k: 27, n: 30, what: SAME_SCENES, later: "30/30 after a later fix to how copies are planned.", source: t2("513, 639–640") },
    policy: { k: 17, n: 40, what: "new scenes completed by the policy trained on 10 demos + 100 copies", ci: "28.5–57.8%", source: t3("1156") },
    failures: {
      what: "Of the policy's 23 failed scenes",
      of: 23,
      reasons: [
        { label: "Picked the cube up, then dropped it", k: 22 },
        { label: "Cube hadn't settled", k: 1 },
      ],
      overlap: false,
      source: t3("1176–1177"),
    },
    reach: { value: "8 of 8", detail: "corners of the shared workspace reached", source: t2("515") },
  },
  {
    key: "openarm",
    robot: "OpenArm",
    status: { label: "Design flaw found", tone: "issue" },
    summary: "Same task, same source demo, same scenes. The simulator found the limit before any hardware did.",
    copies: { k: 0, n: 30, what: SAME_SCENES, source: t2("310, 513") },
    policy: null,
    policyNote: "Not trained: no copies passed the physics check.",
    failures: {
      what: "Of the 30 failed copies",
      of: 30,
      reasons: [
        { label: "Couldn't hold the commanded pose", k: 30 },
        { label: "Collision", k: 13 },
        { label: "Cube not in the bin", k: 10 },
        { label: "Dropped the cube", k: 8 },
      ],
      overlap: true,
      source: t2("310"),
    },
    reach: {
      value: "±45° wrist",
      detail: "keeps a vertical grasp in a 0.15–0.2 m height band, and the shared workspace doesn't fit inside it",
      source: t2("301–304"),
    },
  },
  {
    key: "yours",
    robot: "Your robot",
    status: { label: "Coming next", tone: "neutral" },
    summary: "Upload a URDF, give its parts roles (base, hand, gripper), and run the same workflow to get this card.",
    copies: null,
    policy: null,
    failures: null,
    reach: null,
  },
];
