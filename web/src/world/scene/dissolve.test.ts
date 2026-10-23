import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BUILT_AT, builtAt, dissolvable, dissolve, DISSOLVE_EDGE, FIELD_MAX, injectDissolve, MAX_STEP_S, REVEAL_S, revealOf, stepReveal } from "./dissolve";

describe("the workshop's materialize", () => {
  it("hides the whole room before it plays and shows all of it, edge gone, at the end", () => {
    // The field runs 0 (first to appear) to FIELD_MAX (last): below 0 nothing shows.
    expect(revealOf(0)).toBeLessThan(0);
    expect(revealOf(1)).toBeGreaterThan(FIELD_MAX + DISSOLVE_EDGE);
  });

  it("only ever reveals more as it plays", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.01) {
      expect(revealOf(p)).toBeGreaterThanOrEqual(prev);
      prev = revealOf(p);
    }
  });

  it("plays the moment the room is built (the descent's counter at 100%), not as the scroll goes", () => {
    expect(builtAt(0)).toBe(false);
    expect(builtAt(BUILT_AT - 0.01)).toBe(false);
    expect(builtAt(BUILT_AT)).toBe(true);
    expect(builtAt(1)).toBe(true);
    // The counter reads 100% at the descent's t / 0.95 (descent/index.tsx).
    expect(BUILT_AT).toBeCloseTo(0.95, 5);
  });

  it("is short: the whole room in REVEAL_S of time, at any frame rate, and back out if the visitor scrolls back up", () => {
    expect(REVEAL_S).toBeGreaterThanOrEqual(0.6);
    expect(REVEAL_S).toBeLessThanOrEqual(1.5);
    for (const fps of [30, 60, 144]) {
      let p = 0, t = 0;
      while (p < 1) {
        p = stepReveal(p, true, 1 / fps);
        t += 1 / fps;
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(t).toBeCloseTo(REVEAL_S, 1);
      // Scrolled back above the built point: it plays back out (the particles take the room again).
      for (let k = 0; k < Math.round((REVEAL_S / 2) * fps); k++) p = stepReveal(p, false, 1 / fps);
      expect(p).toBeCloseTo(0.5, 1);
      for (let k = 0; k < 400; k++) p = stepReveal(p, false, 1 / fps);
      expect(p).toBe(0);
    }
  });

  it("jumps instead of playing a long frame (a hidden tab, a stall): never more than a frame's step at once", () => {
    // A 2 s gap between frames counts as one step of at most MAX_STEP_S, so the room still plays in, not pops.
    expect(stepReveal(0, true, 2)).toBeCloseTo(MAX_STEP_S / REVEAL_S, 5);
  });
});

describe("dissolvable materials", () => {
  const shaderOf = (m: THREE.Material) => {
    const lib = m instanceof THREE.MeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.standard;
    return { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  };

  it("injects the field, the discard and the glowing edge into a built-in mesh material", () => {
    for (const m of [new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial()]) {
      const s = shaderOf(m);
      expect(injectDissolve(s)).toBe(true);
      expect(s.vertexShader).toContain("vDissolveW");
      expect(s.vertexShader).toContain("instanceMatrix");
      expect(s.fragmentShader).toContain("discard");
      expect(s.fragmentShader).toContain("dField(vDissolveW)");
      expect(s.uniforms.uReveal).toBe(dissolve.reveal);
    }
  });

  it("leaves a shader it doesn't know alone", () => {
    const s = { vertexShader: "void main(){}", fragmentShader: "void main(){}", uniforms: {} };
    expect(injectDissolve(s)).toBe(false);
    expect(s.fragmentShader).toBe("void main(){}");
  });

  it("patches a material once, with its own program key", () => {
    const m = new THREE.MeshBasicMaterial();
    const key = m.customProgramCacheKey();
    dissolvable(m);
    const once = m.onBeforeCompile;
    dissolvable(m);
    expect(m.onBeforeCompile).toBe(once);
    expect(m.customProgramCacheKey()).not.toBe(key);
    expect(m.customProgramCacheKey()).toContain("dissolve");
  });
});
