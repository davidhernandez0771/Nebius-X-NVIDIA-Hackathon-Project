// Everything this branch added to the room materializes with it (the user saw the bench's new mat
// standing whole while the rest of the room was still particles). Two checks: the materials take the
// dissolve's patch on top of their own, and each new room mesh is mounted inside a <Materialize>.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { makeMat } from "../stations/workbench/mat";
import { withBakedDetail } from "./bakedDetail";
import { patchTree } from "./Materialize";
import benchSrc from "../stations/workbench/Scene.tsx?raw";
import workshopSrc from "../stations/workshop/Scene.tsx?raw";

function shaderFor(m: THREE.Material) {
  const lib = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ? THREE.ShaderLib.standard : THREE.ShaderLib.basic;
  const sh = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
  return sh;
}

describe("the new parts of the room materialize with it", () => {
  it("the bench's mat and turntable top, and the baked room's detail, take the dissolve on top of their own patch", () => {
    const { mesh, release } = makeMat();
    const baked = new THREE.Mesh(new THREE.BoxGeometry(), withBakedDetail(new THREE.MeshBasicMaterial()));
    const root = new THREE.Group().add(mesh, baked);
    patchTree(root);
    for (const m of [mesh.material, baked.material] as THREE.Material[]) {
      expect(m.userData.dissolve).toBe(true);
      const sh = shaderFor(m);
      expect(sh.fragmentShader).toContain("uDissolveColor");
      expect(m.customProgramCacheKey()).toContain("dissolve");
    }
    // Their own patches are still there under it.
    expect(shaderFor(mesh.material as THREE.Material).fragmentShader).toContain("vKind");
    release();
  });

  /** The JSX between a file's <Materialize> and its </Materialize> (all of them). */
  const inside = (src: string) => {
    return [...src.matchAll(/<Materialize>([\s\S]*?)<\/Materialize>/g)].map((m) => m[1]).join("\n");
  };

  it("mounts each new room mesh inside a <Materialize>: the arm, the spiral's band and cartridges, the baked room, the bench's mat", () => {
    const workshop = inside(workshopSrc);
    for (const part of ["<Baked ", "<Arm ", "<Ribbon", "<Helix "]) expect(workshop, part).toContain(part);
    expect(inside(benchSrc)).toContain("b.mat.mesh");
  });
});
