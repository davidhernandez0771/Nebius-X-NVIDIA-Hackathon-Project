import { describe, expect, it } from "vitest";
import { GLYPHS, resolveGlyphs } from "./glyphs";

describe("resolveGlyphs", () => {
  it("shows the real text once every character has resolved", () => {
    expect(resolveGlyphs("Isaac Sim", 9, 0)).toBe("Isaac Sim");
    expect(resolveGlyphs("Isaac Sim", 99, 3)).toBe("Isaac Sim");
  });

  it("resolves from the left; the rest are loader glyphs", () => {
    const s = resolveGlyphs("MediaPipe", 3, 0);
    expect(s.slice(0, 3)).toBe("Med");
    for (const ch of s.slice(3)) expect(GLYPHS).toContain(ch);
    expect(s).toHaveLength(9);
  });

  it("keeps spaces as spaces so the word shapes stay readable", () => {
    expect(resolveGlyphs("Isaac Sim", 0, 5)[5]).toBe(" ");
  });

  it("is the same for the same tick and changes between ticks", () => {
    expect(resolveGlyphs("Isaac Sim", 2, 7)).toBe(resolveGlyphs("Isaac Sim", 2, 7));
    expect(resolveGlyphs("Isaac Sim", 2, 7)).not.toBe(resolveGlyphs("Isaac Sim", 2, 8));
  });
});
