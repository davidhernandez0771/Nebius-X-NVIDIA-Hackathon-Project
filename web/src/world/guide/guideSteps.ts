// The first-visit guide's four steps (Guide.tsx): what SANT does, where you record, where SANT checks and multiplies,
// and the proof. Each step points at a real thing in the workshop's room view (its hub tag, or on a phone the hub
// bar's button for it). Every number comes from the proof data (site/results/proofData.ts), never typed here.
// The words are short and plain on purpose: a judge reads all four in about 30 seconds.
import { CLIMB, LEAD } from "../../site/results/proofData";

/** What a step points at: one of the room's hub items (hubItems.ts), or nothing (the card sits in the middle). */
export type GuideTarget = "shelf" | "machine" | "proof";

/** A way on from a step: a 2D page (a route), or a place in the workshop. */
export type GuideLink = { label: string; to: string } | { label: string; place: "proof" };

export interface GuideStep {
  id: "what" | "record" | "check" | "proof";
  title: string;
  lines: string[];
  target: GuideTarget | null;
  links: GuideLink[];
}

const raw = CLIMB.find((s) => s.key === "raw")!;
const final = LEAD.result;

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "what",
    title: "What SANT does",
    lines: [
      `${LEAD.demos} sloppy mouse demos became a robot that succeeds ${final.k}/${final.n} on scenes it never saw.`,
      `Copying the same demos directly: ${raw.k}/${raw.n}.`,
      "SANT checks demos in physics, multiplies them, and teaches a robot that works.",
    ],
    target: null,
    links: [],
  },
  {
    id: "record",
    title: "Record a demo",
    lines: [
      "Show the robot the job once. Pick a cartridge on the shelf and drop it on the machine.",
      "That opens Record: drive the arm with keys, mouse or camera, and put the cube in the bin.",
    ],
    target: "shelf",
    links: [{ label: "Open Record", to: "/record" }],
  },
  {
    id: "check",
    title: "SANT checks and multiplies it",
    lines: [
      "The machine replays your demo in a physics sim. Bad grabs get fixed or thrown out.",
      "Good demos get copied into many new scenes. That data teaches the robot.",
    ],
    target: "machine",
    links: [],
  },
  {
    id: "proof",
    title: "Here's the proof",
    lines: [
      `Each test was planned first and run once. The final robot: ${final.k}/${final.n} on new scenes.`,
      `The test track replays all ${final.n} real runs, the wins and the misses.`,
    ],
    target: "proof",
    links: [
      { label: "Open the proof wall", place: "proof" },
      { label: "Watch the test track", to: "/test-track" },
    ],
  },
];
