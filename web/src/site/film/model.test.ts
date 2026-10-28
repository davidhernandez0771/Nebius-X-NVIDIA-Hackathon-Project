import { describe, expect, it } from "vitest";
import { captionAt, captions, enter, ramp, scenesAt, wordAt, type Line, type Timeline } from "./model";

const line: Line = {
  key: "a_0",
  start: 10,
  end: 13,
  text: "Ten demos, made with a computer mouse. Sloppy ones.",
  words: ["Ten", "demos", "made", "with", "a", "computer", "mouse", "Sloppy", "ones"].map((w, i) => ({ t: 10 + i * 0.3, d: 0.25, w })),
};

describe("the film's clock", () => {
  it("ramps and eases inside its window only", () => {
    expect(ramp(0, 1, 2)).toBe(0);
    expect(ramp(1.5, 1, 2)).toBe(0.5);
    expect(ramp(3, 1, 2)).toBe(1);
    expect(enter(0.5, 1)).toBe(0);
    expect(enter(5, 1)).toBe(1);
  });

  it("finds when a spoken word starts, and falls back to the line's start", () => {
    expect(wordAt(line, "computer")).toBeCloseTo(11.5);
    expect(wordAt(line, "made with")).toBeCloseTo(10.6);
    expect(wordAt(line, "robot")).toBe(10);
  });

  it("cuts captions at sentence ends, keeps the punctuation, and times them by the words", () => {
    const c = captions(line);
    expect(c.map((x) => x.text)).toEqual(["Ten demos, made with a computer mouse.", "Sloppy ones."]);
    expect(c[0].start).toBeCloseTo(10);
    expect(c[1].start).toBeCloseTo(12.1);
    expect(c[0].end).toBeCloseTo(c[1].start);
  });

  it("shows a caption only while its line plays", () => {
    const tl: Timeline = { fps: 30, width: 1920, height: 1080, duration: 20, scenes: [{ id: "a", start: 0, end: 20, lines: [line] }] };
    expect(captionAt(tl, 9)).toBeNull();
    expect(captionAt(tl, 10.5)).toBe("Ten demos, made with a computer mouse.");
    expect(captionAt(tl, 15)).toBeNull();
  });

  it("cross-fades between neighbouring scenes", () => {
    const tl: Timeline = {
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 20,
      scenes: [
        { id: "a", start: 0, end: 10, lines: [] },
        { id: "b", start: 10, end: 20, lines: [] },
      ],
    };
    expect(scenesAt(tl, 5).map((s) => s.span.id)).toEqual(["a"]);
    const mid = scenesAt(tl, 10);
    expect(mid.map((s) => s.span.id)).toEqual(["a", "b"]);
    expect(mid[0].alpha).toBeCloseTo(0.5);
    expect(scenesAt(tl, 15).map((s) => s.span.id)).toEqual(["b"]);
  });
});
