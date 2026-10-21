import { beforeEach, describe, expect, it } from "vitest";
import { FINISHES, finishOf } from "../../scene/saved";
import { FRESH, STAGES, bench, canAdvance, clearPrinter, draftLabel, nextStage, pickFinish, prevStage, printLabel, resetBench, setDraft, setHover, setStage, subscribeBench } from "./draft";

describe("the bench's draft", () => {
  beforeEach(() => resetBench());

  it("starts with no shell picked, the first robot, and prints the render's blank", () => {
    expect(bench.draft).toEqual(FRESH);
    expect(bench.draft.finish).toBeNull();
    expect(bench.stage).toBe("material");
    expect(draftLabel().code).toBe("+");
  });

  it("merges each change, counts it and tells subscribers; a no-op is silent", () => {
    let heard = 0;
    const off = subscribeBench(() => heard++);
    setDraft({ name: "Kitchen arm" });
    setDraft({ color: "#e2ddd0", robot: "FR3" });
    setDraft({ color: "#e2ddd0" });
    expect(bench.draft).toMatchObject({ name: "Kitchen arm", color: "#e2ddd0", robot: "FR3" });
    expect(bench.edits).toBe(2);
    expect(heard).toBe(2);
    expect(draftLabel()).toMatchObject({ code: "KITCHEN ARM", line: "FRANKA FR3 · 7-DOF · RESEARCH ARM" });
    off();
  });

  it("keeps only a well-formed colour", () => {
    setDraft({ color: "#ABCDEF" });
    expect(bench.draft.color).toBe("#abcdef");
    setDraft({ color: "blue" });
    expect(bench.draft.color).toBe("#abcdef");
  });

  it("prints a label and takes it away on leaving", () => {
    printLabel(draftLabel());
    printLabel(draftLabel());
    expect(bench.prints).toBe(2);
    expect(bench.printed?.band).toContain("YOUR CARTRIDGE");
    clearPrinter();
    expect(bench.printed).toBeNull();
  });
});

describe("the bench's stages", () => {
  beforeEach(() => resetBench());

  it("run material, colour, robot, name, done", () => {
    expect(STAGES).toEqual(["material", "colour", "robot", "name", "done"]);
  });

  it("picking a blank takes its finish and its colour, and counts a pick (the 3D flies it over)", () => {
    const carbon = finishOf("carbon");
    pickFinish("carbon");
    expect(bench.draft.finish).toBe("carbon");
    expect(bench.draft.color).toBe(carbon.color);
    expect(bench.picks).toBe(1);
    // Picking the one already on the turntable does nothing.
    pickFinish("carbon");
    expect(bench.picks).toBe(1);
    pickFinish("brushed");
    expect(bench.picks).toBe(2);
    expect(bench.draft.color).toBe(finishOf("brushed").color);
  });

  it("go on only once the stage is answered: a shell picked, then a name", () => {
    expect(canAdvance("material", bench.draft)).toBe(false);
    expect(nextStage()).toBe(false);
    expect(bench.stage).toBe("material");
    pickFinish(FINISHES[2].id);
    expect(nextStage()).toBe(true);
    expect(bench.stage).toBe("colour");
    expect(nextStage()).toBe(true);
    expect(bench.stage).toBe("robot");
    expect(nextStage()).toBe(true);
    expect(bench.stage).toBe("name");
    // The name stage finishes through the save, never through Next.
    setDraft({ name: "  " });
    expect(canAdvance("name", bench.draft)).toBe(false);
    setDraft({ name: "desk arm" });
    expect(canAdvance("name", bench.draft)).toBe(true);
    expect(nextStage()).toBe(false);
    expect(bench.stage).toBe("name");
  });

  it("go back one at a time, never before the first; done goes nowhere", () => {
    pickFinish("matte");
    setStage("robot");
    expect(prevStage()).toBe(true);
    expect(bench.stage).toBe("colour");
    prevStage();
    expect(prevStage()).toBe(false);
    expect(bench.stage).toBe("material");
    setStage("done");
    expect(prevStage()).toBe(false);
    expect(bench.stage).toBe("done");
  });

  it("tell subscribers when the stage or the hovered blank changes", () => {
    let heard = 0;
    const off = subscribeBench(() => heard++);
    setStage("colour");
    setStage("colour");
    setHover(3);
    setHover(3);
    setHover(-1);
    expect(heard).toBe(3);
    expect(bench.hover).toBe(-1);
    off();
  });

  it("a fresh bench is back at the material, nothing picked", () => {
    pickFinish("gloss");
    setStage("name");
    resetBench();
    expect(bench.stage).toBe("material");
    expect(bench.draft.finish).toBeNull();
  });
});

describe("a save's flight to the spiral", () => {
  beforeEach(() => resetBench());

  it("marks the saved place as landing until the flight ends, and tells subscribers", async () => {
    const { endFlight, startFlight } = await import("./draft");
    let heard = 0;
    const off = subscribeBench(() => heard++);
    expect(bench.landing).toBe(-1);
    startFlight(2);
    expect(bench.landing).toBe(2);
    expect(bench.flights).toBe(1);
    endFlight();
    endFlight();
    expect(bench.landing).toBe(-1);
    expect(heard).toBe(2);
    startFlight(0);
    resetBench();
    expect(bench.landing).toBe(-1);
    off();
  });
});
