import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeFireflies } from "./fireflies";
import { fireflies } from "./fireflyPlan";
import { forestLayout } from "./forestGeometry";
import { ROBOT_TIERS } from "./forestRobots";

describe("the fireflies, drawn", () => {
  const plan = fireflies(300, forestLayout(), ROBOT_TIERS.low.ids);

  it("are one Points draw, every firefly a vertex carrying its plan", () => {
    const f = makeFireflies(plan);
    expect(f.points).toBeInstanceOf(THREE.Points);
    const g = f.points.geometry;
    expect(g.attributes.position.count).toBe(300);
    for (const a of ["aCenter", "aColor", "aKind", "aRand"]) expect(g.attributes[a]).toBeDefined();
    const m = f.points.material as THREE.ShaderMaterial;
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    f.dispose();
  });

  it("move only in the shader: update writes uniforms, never the positions", () => {
    const f = makeFireflies(plan);
    const before = (f.points.geometry.attributes.position.array as Float32Array).slice();
    f.update({ time: 12, light: 1, drop: 0, swirl: 0.5, pr: 2, still: false });
    const u = (f.points.material as THREE.ShaderMaterial).uniforms;
    expect(u.uTime.value).toBe(12);
    expect(u.uSwirl.value).toBe(0.5);
    expect(u.uStill.value).toBe(0);
    expect(f.points.geometry.attributes.position.array).toEqual(before);
    f.dispose();
  });

  it("hold still under reduced motion (they only blink)", () => {
    const f = makeFireflies(plan);
    f.update({ time: 3, light: 1, drop: 0, swirl: 0, pr: 1, still: true });
    expect((f.points.material as THREE.ShaderMaterial).uniforms.uStill.value).toBe(1);
    f.dispose();
  });
});
