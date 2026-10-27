// The guide's words: four steps, each pointing at a real thing in the room, and every number from the proof data.
import { describe, expect, it } from "vitest";
import { CLIMB, LEAD } from "../../site/results/proofData";
import { HUB_TAGS } from "../stations/workshop/hubItems";
import { GUIDE_STEPS } from "./guideSteps";

const text = (i: number) => [GUIDE_STEPS[i].title, ...GUIDE_STEPS[i].lines].join(" ");
const raw = CLIMB.find((s) => s.key === "raw")!;

describe("the guide's steps", () => {
  it("are the four the brief asks for, in order", () => {
    expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["What SANT does", "Record a demo", "SANT checks and multiplies it", "Here's the proof"]);
  });

  it("take the headline numbers from proofData (the demos, the final test, the raw copies)", () => {
    expect(text(0)).toContain(`${LEAD.demos} sloppy mouse demos`);
    expect(text(0)).toContain(`${LEAD.result.k}/${LEAD.result.n}`);
    expect(text(0)).toContain(`${raw.k}/${raw.n}`);
    expect(text(3)).toContain(`${LEAD.result.k}/${LEAD.result.n}`);
    expect(text(3)).toContain(`all ${LEAD.result.n} real runs`);
  });

  it("point at things the room really has (its hub tags), the first at nothing", () => {
    const ids = HUB_TAGS.map((t) => t.id as string);
    expect(GUIDE_STEPS[0].target).toBeNull();
    for (const s of GUIDE_STEPS.slice(1)) expect(ids).toContain(s.target);
    expect(GUIDE_STEPS.map((s) => s.target)).toEqual([null, "shelf", "machine", "proof"]);
  });

  it("lead on to Record and to the test track", () => {
    expect(GUIDE_STEPS[1].links).toContainEqual({ label: "Open Record", to: "/record" });
    expect(GUIDE_STEPS[3].links).toContainEqual({ label: "Watch the test track", to: "/test-track" });
    expect(GUIDE_STEPS[3].links).toContainEqual({ label: "Open the proof wall", place: "proof" });
  });

  it("stay short and plain: short sentences, a quick read", () => {
    for (const s of GUIDE_STEPS) {
      const words = s.lines.join(" ").split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(36);
      for (const sentence of s.lines.join(" ").split(/[.:]\s/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(18);
    }
  });
});
