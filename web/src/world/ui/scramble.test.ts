import { describe, expect, it } from "vitest";
import { GLYPHS, scramble, scrambleText } from "./scramble";

describe("scrambleText", () => {
  it("keeps the length and the spaces, and settles on the final text", () => {
    const f = "CHECKED BY PHYSICS.";
    const mid = scrambleText(f, 0.4, () => 0);
    expect(mid).toHaveLength(f.length);
    expect(mid[7]).toBe(" ");
    expect(mid.endsWith(GLYPHS[0].repeat(3))).toBe(true);
    expect(scrambleText(f, 1)).toBe(f);
  });

  it("reveals left to right", () => {
    const f = "ABCDEFGHIJ";
    const at = (k: number) => [...scrambleText(f, k, () => 0)].filter((c, i) => c === f[i]).length;
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeLessThan(at(0.8));
    expect(at(0.8)).toBeLessThan(at(1));
  });
});

describe("scramble", () => {
  it("sets the text at once with reduced motion", () => {
    const el = document.createElement("h2");
    el.textContent = "x";
    scramble(el, "MULTIPLIED.", { reduced: true });
    expect(el.textContent).toBe("MULTIPLIED.");
  });
});
