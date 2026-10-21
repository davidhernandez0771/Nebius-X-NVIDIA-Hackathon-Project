import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TIERS } from "../core/quality";
import { SOFT_LINE_GLSL, softLine, vertexPbrMaterial } from "./materials";

/** What a row of pixels (centres at 0.5, 1.5, …) shows of a line `half` px wide either side of `at`. */
function row(at: number, half: number, f = softLine): number[] {
  return Array.from({ length: 12 }, (_, i) => f(i + 0.5 - at, 1, half));
}
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
/** A hard geometric edge: a pixel is lit when its centre is inside the line. */
const hard = (d: number, _px: number, half: number) => (Math.abs(d) < half ? 1 : 0);

describe("softLine, the coverage of a thin glowing line", () => {
  it("draws a wide line solid, with a one-pixel ramp at each edge", () => {
    expect(softLine(0, 1, 5)).toBe(1);
    expect(softLine(5, 1, 5)).toBeCloseTo(0.5, 6);
    expect(softLine(5.6, 1, 5)).toBe(0);
    expect(softLine(-4.4, 1, 5)).toBe(1);
  });

  it("fades a line thinner than a pixel instead of breaking it up, keeping its light", () => {
    // A 0.2 px line is drawn one pixel wide at a fifth of the brightness.
    expect(softLine(0, 1, 0.1)).toBeCloseTo(0.2, 6);
    for (const half of [0.05, 0.1, 0.3, 0.5, 2]) expect(sum(row(6, half))).toBeCloseTo(2 * half, 1);
  });

  it("shows the same light wherever the line falls between pixel centres, so a sliding camera can't make it crawl", () => {
    for (const half of [0.08, 0.25, 0.7, 1.5]) {
      const lit = Array.from({ length: 11 }, (_, k) => sum(row(6 + k / 10, half)));
      expect(Math.max(...lit) - Math.min(...lit)).toBeLessThan(0.05 * Math.max(1, 2 * half));
      // A hard edge pops between all and nothing as it slides (what the rings did).
      const edge = Array.from({ length: 11 }, (_, k) => sum(row(6 + k / 10, half, hard)));
      expect(Math.max(...edge) - Math.min(...edge)).toBeGreaterThanOrEqual(1);
    }
  });

  it("is the same function in the shaders", () => {
    expect(SOFT_LINE_GLSL).toContain("float softLine(float d, float px, float halfW)");
    expect(SOFT_LINE_GLSL).toContain("max(halfW, 0.5 * px)");
    expect(SOFT_LINE_GLSL).toContain("clamp((h - abs(d)) / px + 0.5, 0.0, 1.0) * (halfW / h)");
  });
});

describe("vertexPbrMaterial, metalness and roughness per vertex (the machine's merged body)", () => {
  it("is Lambert on low, standard elsewhere, both coloured per vertex", () => {
    expect(vertexPbrMaterial(TIERS.low)).toBeInstanceOf(THREE.MeshLambertMaterial);
    const m = vertexPbrMaterial(TIERS.high) as THREE.MeshStandardMaterial;
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.vertexColors).toBe(true);
    expect([m.metalness, m.roughness]).toEqual([1, 1]);
  });

  it("reads aMR (metalness, roughness) in place of the material's own", () => {
    const m = vertexPbrMaterial(TIERS.high);
    const sh = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <metalnessmap_fragment>\n#include <roughnessmap_fragment>\n}",
    };
    m.onBeforeCompile(sh as never, undefined as never);
    expect(sh.vertexShader).toContain("attribute vec2 aMR;");
    expect(sh.vertexShader).toContain("vMR = aMR;");
    expect(sh.fragmentShader).toContain("float metalnessFactor = metalness * vMR.x;");
    expect(sh.fragmentShader).toContain("float roughnessFactor = roughness * vMR.y;");
    expect(sh.fragmentShader).not.toContain("#include <metalnessmap_fragment>");
    expect(m.customProgramCacheKey()).toContain("vertex-pbr");
  });
});
