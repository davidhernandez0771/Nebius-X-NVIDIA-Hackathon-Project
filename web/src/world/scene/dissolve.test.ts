import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dissolvable, dissolve, DISSOLVE_EDGE, FIELD_MAX, injectDissolve, LAMPS_AT, revealAt } from "./dissolve";

describe("the workshop's materialize", () => {
  it("hides the whole room before the travel and shows all of it, edge gone, by the end", () => {
    // The field runs 0 (first to appear) to FIELD_MAX (last): below 0 nothing shows.
    expect(revealAt(0)).toBeLessThan(0);
    expect(revealAt(1)).toBeGreaterThan(FIELD_MAX + DISSOLVE_EDGE);
  });

  it("only ever reveals more as the travel goes on", () => {
    let prev = -Infinity;
    for (let a = 0; a <= 1; a += 0.01) {
      expect(revealAt(a)).toBeGreaterThanOrEqual(prev);
      prev = revealAt(a);
    }
  });

  it("switches the lamps on once the room is whole", () => {
    expect(revealAt(LAMPS_AT)).toBeGreaterThan(FIELD_MAX + DISSOLVE_EDGE);
    expect(LAMPS_AT).toBeLessThan(1);
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
