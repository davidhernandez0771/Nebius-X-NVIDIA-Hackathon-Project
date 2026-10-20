import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_PIVOT, MACHINE_PIVOT, stop } from "../../scene/layout";
import { BOARDS, WALL } from "../../scene/wallPlan";
import { CANVAS, HOLO_TAGS, PANEL_PX, TITLE_PX, holoMode, holoTag, panelNormal, projectPanel, setHot, subscribeHot, tagHot } from "./holoTags";

const HUB = stop("Workshop intro");
function hubCamera(w = 1280, h = 720): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(HUB.fov, w / h, 0.1, 220);
  c.position.set(...HUB.position);
  c.lookAt(...HUB.target);
  c.updateMatrixWorld(true);
  return c;
}
const xz = (a: THREE.Vector3, p: readonly number[]) => Math.hypot(a.x - p[0], a.z - p[2]);

describe("the room view's holographic tags: where they stand", () => {
  it("are the four things to click, in the room's Tab order", () => {
    expect(HOLO_TAGS.map((t) => t.id)).toEqual(["shelf", "machine", "bench", "wall"]);
  });

  it("each rise from an emitter on its own object, up to the panel", () => {
    for (const t of HOLO_TAGS) expect(t.emitter.y, t.id).toBeLessThan(t.center.y - t.height / 2);
    // The bench: on its top (the cutting mat, 3.335 local), within its footprint.
    const bench = holoTag("bench");
    expect(bench.emitter.y).toBeCloseTo(3.335 + BENCH_PIVOT.position[1], 1);
    expect(xz(bench.emitter, BENCH_PIVOT.position)).toBeLessThan(3.5);
    // The machine: on its top (the port's top, 4.91 local), within its footprint.
    const machine = holoTag("machine");
    expect(machine.emitter.y).toBeCloseTo(4.91 + MACHINE_PIVOT.position[1], 1);
    expect(xz(machine.emitter, MACHINE_PIVOT.position)).toBeLessThan(4);
    // The wall: on the top board's front edge, on the left wall.
    const wall = holoTag("wall");
    expect(wall.emitter.y).toBeCloseTo(BOARDS[2], 2);
    expect(-wall.emitter.x).toBeGreaterThanOrEqual(WALL.inner - 0.01);
    expect(-wall.emitter.x).toBeLessThanOrEqual(WALL.outer);
    // The shelf: on the spiral (its cartridges stand 4.07 m out from the axis).
    expect(Math.hypot(holoTag("shelf").emitter.x, holoTag("shelf").emitter.z)).toBeLessThan(4.7);
  });

  it("are tilted toward the room view's camera, so their text reads square on", () => {
    for (const t of HOLO_TAGS) {
      const toEye = new THREE.Vector3(...HUB.position).sub(t.center).normalize();
      expect(panelNormal(t).dot(toEye), t.id).toBeGreaterThan(0.97);
    }
  });
});

describe("the room view's holographic tags: on screen (1280×720)", () => {
  const cam = hubCamera();
  const rects = HOLO_TAGS.map((t) => ({ id: t.id, ...projectPanel(t, cam, 1280, 720) }));

  it("sit in the view, under the hub bar, above Ask SANT and clear of the journey rail", () => {
    for (const r of rects) {
      expect(r.x0, r.id).toBeGreaterThan(16);
      expect(r.x1, r.id).toBeLessThan(1140);
      expect(r.y0, r.id).toBeGreaterThan(72);
      expect(r.y1, r.id).toBeLessThan(600);
    }
  });

  it("don't overlap each other", () => {
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart = a.x1 + 8 < b.x0 || b.x1 + 8 < a.x0 || a.y1 + 8 < b.y0 || b.y1 + 8 < a.y0;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
  });

  it("are about the HTML cards' size, with titles big enough to read", () => {
    for (const r of rects) {
      const w = r.x1 - r.x0;
      expect(w, r.id).toBeGreaterThan(PANEL_PX.w * 0.85);
      expect(w, r.id).toBeLessThan(PANEL_PX.w * 1.2);
      expect(TITLE_PX * (w / CANVAS.w), r.id).toBeGreaterThanOrEqual(12);
    }
  });
});

describe("the room view's holographic tags: when, and the hover state", () => {
  it("are holograms in 3D on high and ultra at desktop widths; the HTML cards otherwise", () => {
    const base = { mode: "3d", tier: "high", reduced: false, width: 1280 } as const;
    expect(holoMode(base)).toBe(true);
    expect(holoMode({ ...base, tier: "ultra" })).toBe(true);
    expect(holoMode({ ...base, tier: "low" })).toBe(false);
    expect(holoMode({ ...base, reduced: true })).toBe(false);
    expect(holoMode({ ...base, mode: "stills" })).toBe(false);
    expect(holoMode({ ...base, width: 390 })).toBe(false);
  });

  it("light the hovered or focused tag, and tell the 3D once per change", () => {
    let heard = 0;
    const off = subscribeHot(() => heard++);
    setHot("machine", true);
    setHot("machine", true);
    expect(tagHot("machine")).toBe(true);
    expect(tagHot("shelf")).toBe(false);
    setHot("machine", false);
    expect(tagHot("machine")).toBe(false);
    expect(heard).toBe(2);
    off();
  });

  it("stays lit while it has focus, even when the pointer leaves", () => {
    setHot("bench", true, "focus");
    setHot("bench", true, "pointer");
    setHot("bench", false, "pointer");
    expect(tagHot("bench")).toBe(true);
    setHot("bench", false, "focus");
    expect(tagHot("bench")).toBe(false);
  });
});

describe("the room view's holographic tags: one geometry for all four", () => {
  it("holds each tag's panel, light cone and emitter, with its own row of the text atlas", async () => {
    const { buildHoloGeometry, KIND, panelCorners } = await import("./holoTags");
    const g = buildHoloGeometry(HOLO_TAGS);
    const pos = g.getAttribute("position");
    const kind = g.getAttribute("aKind");
    const tag = g.getAttribute("aTag");
    const uv = g.getAttribute("uv");
    HOLO_TAGS.forEach((t, i) => {
      const of = (k: number) => [...Array(pos.count).keys()].filter((v) => tag.getX(v) === i && kind.getX(v) === k);
      // The panel's four corners, its atlas row only.
      const panel = of(KIND.panel);
      expect(panel).toHaveLength(4);
      const corners = panelCorners(t);
      panel.forEach((v, c) => expect(new THREE.Vector3().fromBufferAttribute(pos, v).distanceTo(corners[c])).toBeLessThan(1e-6));
      for (const v of panel) {
        expect(uv.getY(v)).toBeGreaterThanOrEqual(1 - (i + 1) / HOLO_TAGS.length - 1e-9);
        expect(uv.getY(v)).toBeLessThanOrEqual(1 - i / HOLO_TAGS.length + 1e-9);
      }
      // The cone: from the emitter up to the panel's lower edge.
      const cone = of(KIND.cone);
      expect(cone.length).toBeGreaterThanOrEqual(3);
      expect(cone.some((v) => new THREE.Vector3().fromBufferAttribute(pos, v).distanceTo(t.emitter) < 1e-6)).toBe(true);
      // The emitter: a small disc lying flat on the object.
      const disc = of(KIND.emitter);
      expect(disc).toHaveLength(4);
      for (const v of disc) expect(pos.getY(v)).toBeCloseTo(t.emitter.y + 0.02, 6);
    });
    expect(g.index).not.toBeNull();
  });
});
