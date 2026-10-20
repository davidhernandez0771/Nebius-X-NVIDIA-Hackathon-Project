import { beforeEach, describe, expect, it } from "vitest";
import { FRESH, bench, clearPrinter, draftLabel, printLabel, resetBench, setDraft, subscribeBench } from "./draft";

describe("the bench's draft", () => {
  beforeEach(() => resetBench());

  it("starts blank on Graphite with the first robot, and prints the render's blank", () => {
    expect(bench.draft).toEqual(FRESH);
    expect(draftLabel().code).toBe("+");
  });

  it("merges each change, counts it and tells subscribers; a no-op is silent", () => {
    let heard = 0;
    const off = subscribeBench(() => heard++);
    setDraft({ name: "Kitchen arm" });
    setDraft({ shell: "bone", robot: "FR3" });
    setDraft({ shell: "bone" });
    expect(bench.draft).toEqual({ name: "Kitchen arm", shell: "bone", robot: "FR3" });
    expect(bench.edits).toBe(2);
    expect(heard).toBe(2);
    expect(draftLabel()).toMatchObject({ code: "KITCHEN ARM", line: "FRANKA FR3 · 7-DOF · RESEARCH ARM" });
    off();
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
