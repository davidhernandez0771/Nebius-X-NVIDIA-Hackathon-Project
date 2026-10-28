import { describe, expect, it } from "vitest";
import { BASE_HALF, BASE_RINGS, DIAL, baseRingsShader } from "./HoloTwin";

describe("the hologram's rings of light", () => {
  it("keeps the rings and the turning dial where they were (radius, width, brightness)", () => {
    expect(BASE_RINGS.map((r) => [r.r, r.w, r.a])).toEqual([
      [1.55, 0.02, 0.45],
      [1.15, 0.012, 0.45],
      [0.5, 0.03, 0.8],
    ]);
    expect([DIAL.r - DIAL.w, DIAL.r + DIAL.w, DIAL.arcs, DIAL.arc]).toEqual([1.7, 1.78, 3, Math.PI / 2.4]);
  });

  it("draws them all on one quad, with room past the dial for the soft edge", () => {
    // Was six meshes (three rings, three dial arcs) with hard edges 2–6 cm wide.
    expect(BASE_HALF).toBeGreaterThan(DIAL.r + DIAL.w + 0.08);
    const frag = baseRingsShader().fragmentShader;
    for (const r of BASE_RINGS) expect(frag).toContain(`softLine(r - ${r.r.toFixed(4)}, px, ${r.w.toFixed(4)})`);
    expect(frag).toContain(`softLine(r - ${DIAL.r.toFixed(4)}, px, ${DIAL.w.toFixed(4)})`);
    expect(frag).toContain("#include <colorspace_fragment>");
  });
});
