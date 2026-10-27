import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { inCrack } from "./forestPlan";
import { placeUniforms } from "./placeShaders";
import { GLOW_TRIS, RIFT_EMBERS, RIFT_STONES, STONE_TRIS, crackPoint, makeRiftDetail, riftStones, riftTriangles } from "./riftDetail";
import { CRACK } from "./layout";

describe("the rift's detail, seen from the forest", () => {
  it("scatters stones along the lip, out of the crack and close to its edge, bigger nearer it", () => {
    const s = riftStones(120);
    expect(s.length).toBe(120);
    for (const st of s) {
      expect(inCrack(st.x, st.z)).toBe(false);
      expect(inCrack(st.x, st.z, -2.2)).toBe(true);
      expect(st.size).toBeGreaterThan(0.02);
      expect(st.size).toBeLessThan(0.4);
    }
    const near = s.filter((x) => x.out < 0.5), far = s.filter((x) => x.out > 1.2);
    const mean = (l: typeof s) => l.reduce((a, x) => a + x.size, 0) / l.length;
    expect(near.length).toBeGreaterThan(far.length);
    expect(mean(near)).toBeGreaterThan(mean(far));
    expect(riftStones(120)).toEqual(s);
  });

  it("finds its own frame: the crack's centre and its ends along its direction", () => {
    expect(crackPoint(0, 0)).toEqual([CRACK.center[0], CRACK.center[1]]);
    const [x, z] = crackPoint(CRACK.halfLength, 0);
    expect(Math.hypot(x - CRACK.center[0], z - CRACK.center[1])).toBeCloseTo(CRACK.halfLength, 6);
  });

  it("costs few triangles (none for stones on the low tier) and more embers the richer the tier", () => {
    expect(RIFT_STONES.low).toBe(0);
    expect(riftTriangles("low")).toBe(GLOW_TRIS);
    expect(riftTriangles("high")).toBe(RIFT_STONES.high * STONE_TRIS + GLOW_TRIS);
    expect(GLOW_TRIS).toBeLessThanOrEqual(100);
    expect(RIFT_EMBERS.low).toBeLessThan(RIFT_EMBERS.high);
    expect(RIFT_EMBERS.high).toBeLessThanOrEqual(RIFT_EMBERS.ultra);
  });

  it("is drawn by the forest's light: its glow and embers read the forest's own uLight (out for the fall)", () => {
    const u = placeUniforms({ k: 0.04, mistY: 0, mistK: 1, fog: "#000", mist: "#000" });
    const glow = { value: 0 };
    const r = makeRiftDetail(u, glow, "high");
    const names = r.group.children.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["rift:stones", "rift:glow", "rift:embers"]));
    for (const c of r.group.children) {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial;
      if (c.name !== "rift:stones") expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.uniforms.uLight).toBe(u.uLight);
      expect(m.uniforms.uGlow ?? glow).toBe(glow);
    }
    r.dispose();
  });
});
