import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GLINTS, withBakedDetail } from "./bakedDetail";
import { canDissolve, dissolvable } from "./dissolve";

/** The shader three would hand a MeshBasicMaterial's onBeforeCompile (with the chunks still as includes). */
function basicShader() {
  return {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms),
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe("the baked room's detail", () => {
  it("stays a built-in material the materialize can still take over, and chains with it", () => {
    const m = withBakedDetail(new THREE.MeshBasicMaterial());
    expect(canDissolve(m)).toBe(true);
    dissolvable(m);
    const sh = basicShader();
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    // Both patches went in: the detail and the glints, then the dissolve's edge, before the output.
    expect(sh.vertexShader).toContain("vDetailW = (modelMatrix * vec4(position, 1.0)).xyz;");
    expect(sh.fragmentShader).toContain("diffuseColor.rgb *= bkDetail;");
    expect(sh.fragmentShader).toContain("uGlints[i]");
    expect(sh.fragmentShader.indexOf("uGlints[i]")).toBeLessThan(sh.fragmentShader.indexOf("#include <opaque_fragment>"));
    expect(sh.fragmentShader).toContain("uDissolveColor");
    expect((sh.uniforms as Record<string, { value: unknown }>).uGlints.value).toHaveLength(GLINTS.length);
    expect(m.customProgramCacheKey()).toContain("baked-detail");
    expect(m.customProgramCacheKey()).toContain("dissolve");
  });

  it("declares nothing the materialize's own GLSL declares (both land in the same main())", () => {
    const m = dissolvable(withBakedDetail(new THREE.MeshBasicMaterial()));
    const sh = basicShader();
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    const decl = /\b(?:float|vec2|vec3|vec4|int)\s+(\w+)\s*[=;(]/g;
    const ours = new Set([...sh.fragmentShader.matchAll(decl)].map((x) => x[1]).filter((n) => n.startsWith("bk")));
    expect(ours.size).toBeGreaterThan(5);
    for (const name of ours) {
      const n = [...sh.fragmentShader.matchAll(new RegExp(`\\b(?:float|vec2|vec3|vec4|int)\\s+${name}\\s*[=;(]`, "g"))].length;
      expect(n, name).toBe(1);
    }
    // And none of ours shadows a name the dissolve declares.
    for (const theirs of ["dN", "dEdge", "dField", "dHash", "dNoise"]) expect(ours.has(theirs)).toBe(false);
  });

  it("glints the pendant lamps over the bench and the machine, and the light over the spiral", () => {
    expect(GLINTS).toHaveLength(3);
    for (const g of GLINTS) expect(g.y).toBeGreaterThan(10);
    expect(GLINTS[0].x).toBeLessThan(-5);
    expect(GLINTS[1].x).toBeGreaterThan(5);
  });
});
