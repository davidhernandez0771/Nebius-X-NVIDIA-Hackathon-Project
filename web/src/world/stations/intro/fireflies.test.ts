import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeFireflies } from "./fireflies";
import { LANTERNS, blinkAt, driftAt, fireflies, KIND } from "./fireflyPlan";
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

  it("light the forest round them: the lanterns' places and glow, for the surfaces' shaders, dark when the forest is", () => {
    const f = makeFireflies(plan);
    expect(f.glows.position.length).toBe(LANTERNS);
    expect(f.glows.color.length).toBe(LANTERNS);
    f.update({ time: 7, light: 0, drop: 0, swirl: 0, pr: 1, still: false });
    for (const p of f.glows.position) expect(p.w).toBe(0);
    f.update({ time: 7, light: 1, drop: 0, swirl: 0, pr: 1, still: false });
    const lanterns = [...Array(plan.count).keys()].filter((i) => plan.kind[i] === KIND.lantern);
    lanterns.forEach((i, k) => {
      const r = [plan.rand[i * 4], plan.rand[i * 4 + 1], plan.rand[i * 4 + 2], plan.rand[i * 4 + 3]] as const;
      const d = driftAt(r, 7);
      const p = f.glows.position[k];
      expect(p.x).toBeCloseTo(plan.position[i * 3] + d[0], 4);
      expect(p.y).toBeCloseTo(plan.position[i * 3 + 1] + d[1], 4);
      expect(p.z).toBeCloseTo(plan.position[i * 3 + 2] + d[2], 4);
      expect(p.w).toBeCloseTo(blinkAt(r, 7), 4);
    });
    // Through the fall (the forest out) they light nothing: the crack's light is its own.
    f.update({ time: 7, light: 0, drop: 1, swirl: 1, pr: 1, still: false });
    for (const p of f.glows.position) expect(p.w).toBe(0);
    f.dispose();
  });

  it("hold still under reduced motion (they only blink)", () => {
    const f = makeFireflies(plan);
    f.update({ time: 3, light: 1, drop: 0, swirl: 0, pr: 1, still: true });
    expect((f.points.material as THREE.ShaderMaterial).uniforms.uStill.value).toBe(1);
    f.dispose();
  });
});
