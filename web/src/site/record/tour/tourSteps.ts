// The /record tour's six cards (RecordTour.tsx), 2026-10-27: "they go in and see the robot demo running and a bunch of
// stuff and they are not going to know what they are looking at" (the user). Each card rings the real thing on the
// page: where you drive, the robot (an example until you start), the three aiming views, the live readouts, Record
// and the counter, and Run SANT. The words are short and plain: a first-timer reads all six in under a minute.
// The one number comes from the proof data (site/results/proofData.ts), never typed here.
import { LEAD } from "../../results/proofData";

/**
 * What a card rings: one ring per entry. An entry lists CSS selectors to try in order; the first that matches a
 * visible element wins, and if it matches several (the twin's three small views) the ring goes round all of them.
 * The first ring is the one the card stands next to.
 */
export type TourRing = readonly string[];

export interface TourStep {
  id: "drive" | "robot" | "views" | "readouts" | "record" | "run";
  title: string;
  lines: readonly string[];
  rings: readonly TourRing[];
}

const final = LEAD.result;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "drive",
    title: "Drive the robot from here",
    lines: [
      "Pick an input: Keyboard, Mouse or Camera. Then press Start.",
      "Keyboard is the easiest: W A S D move the gripper, R and F take it up and down, Space opens and closes it.",
    ],
    rings: [[".rg-cam"]],
  },
  {
    id: "robot",
    title: "This is the robot",
    lines: [
      "Until you press Start, it plays an example: a demo SANT already checked in physics and verified. That isn't you.",
      "Once you start and the simulator connects, it becomes your robot and moves as you drive.",
    ],
    rings: [[".rg-twin3d .twin3d__front", ".rg-twin3d"]],
  },
  {
    id: "views",
    title: "Three more views help you aim",
    lines: [
      "Side shows how high the gripper is. Top shows where it is over the table.",
      "ALIGN looks straight down: first at the cube, then, once you hold it, at the bin. Δx and Δy say how far off you are.",
    ],
    rings: [[".rg-twin3d .twin3d__cell:not(.twin3d__front)", ".rg-twin3d"]],
  },
  {
    id: "readouts",
    title: "Live readouts",
    lines: [
      "gripper_cmd: whether the gripper is open or closed.",
      "ee_target_z: how high the gripper is, in metres. ee_target_y: how far left or right it is.",
      "They show a dash until you drive.",
    ],
    rings: [[".rg-trio"]],
  },
  {
    id: "record",
    title: "Record and stop",
    lines: [
      "Record (or Enter) starts a demo; press it again to stop and save it. The clock times it.",
      "Record wakes up once the simulator is connected. The counter at the bottom shows how many demos you've saved.",
    ],
    rings: [[".rg-rec"], [".rg-time"], ['.rg-cell[aria-label="recorded"]']],
  },
  {
    id: "run",
    title: "Then Run SANT",
    lines: [
      "Run SANT takes the demos you saved to the pipeline.",
      "There SANT checks each one in physics, repairs what it can, and multiplies the good ones into many new scenes.",
      `The proof: ${LEAD.demos} human mouse demos became a robot that succeeds ${final.k}/${final.n} on scenes it never saw.`,
    ],
    rings: [[".rg-run"]],
  },
];
