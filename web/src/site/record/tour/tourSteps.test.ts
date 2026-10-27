// The /record tour's six cards say what the user asked for, in plain words, and the one number is the proof data's.
import { describe, expect, it } from "vitest";
import { LEAD } from "../../results/proofData";
import { TOUR_STEPS } from "./tourSteps";

const text = (id: string) => {
  const s = TOUR_STEPS.find((x) => x.id === id)!;
  return `${s.title} ${s.lines.join(" ")}`;
};

describe("the /record tour's cards", () => {
  it("are six, in order: drive, the robot, the views, the readouts, record, run SANT", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["drive", "robot", "views", "readouts", "record", "run"]);
    for (const s of TOUR_STEPS) {
      expect(s.lines.length).toBeGreaterThan(0);
      expect(s.lines.length).toBeLessThanOrEqual(3);
      expect(s.rings.length).toBeGreaterThan(0);
    }
  });

  it("say the robot is an example until you start: a demo SANT already verified", () => {
    expect(text("robot")).toMatch(/Until you press Start, it plays an example/);
    expect(text("robot")).toMatch(/verified/);
  });

  it("name the inputs and Start, the three views, the readouts, Record and the counter, and what Run SANT does", () => {
    expect(text("drive")).toMatch(/Keyboard, Mouse or Camera/);
    expect(text("drive")).toMatch(/Start/);
    expect(text("views")).toMatch(/Side/);
    expect(text("views")).toMatch(/Top/);
    expect(text("views")).toMatch(/ALIGN/);
    expect(text("views")).toMatch(/bin/);
    expect(text("readouts")).toMatch(/gripper_cmd/);
    expect(text("readouts")).toMatch(/open or closed/);
    expect(text("readouts")).toMatch(/how high/);
    expect(text("record")).toMatch(/Record/);
    expect(text("record")).toMatch(/counter/);
    expect(text("run")).toMatch(/Run SANT/);
    expect(text("run")).toMatch(/checks .* in physics, repairs .*multiplies/);
  });

  it("take their one number from the proof data", () => {
    expect(text("run")).toContain(`${LEAD.demos} human mouse demos`);
    expect(text("run")).toContain(`${LEAD.result.k}/${LEAD.result.n}`);
  });

  it("ring the page's real elements", () => {
    const all = TOUR_STEPS.flatMap((s) => s.rings.flat()).join(" ");
    for (const sel of [".rg-cam", ".rg-twin3d", ".twin3d__cell", ".rg-trio", ".rg-rec", ".rg-time", 'aria-label="recorded"', ".rg-run"]) expect(all).toContain(sel);
  });
});
