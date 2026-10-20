import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_PIVOT, MACHINE_PIVOT, stop } from "../../scene/layout";
import { BOARDS, WALL } from "../../scene/wallPlan";
import {
  HOLO_TAGS,
  KIND,
  LABEL,
  beamEnd,
  boxCorners,
  buildHoloGeometry,
  holoMode,
  holoTag,
  objectPoints,
  panelNormal,
  projectLabel,
  restWidth,
  screenBox,
  setHot,
  subscribeHot,
  tagHot,
  type Rect,
} from "./holoTags";

const HUB = stop("Workshop intro");
function hubCamera(w = 1280, h = 720): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(HUB.fov, w / h, 0.1, 220);
  c.position.set(...HUB.position);
  c.lookAt(...HUB.target);
  c.updateMatrixWorld(true);
  return c;
}
const xz = (a: THREE.Vector3, p: readonly number[]) => Math.hypot(a.x - p[0], a.z - p[2]);
const apart = (a: Rect, b: Rect, gap = 6) => a.x1 + gap < b.x0 || b.x1 + gap < a.x0 || a.y1 + gap < b.y0 || b.y1 + gap < a.y0;
const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

describe("the room view's holographic labels: where they stand", () => {
  it("are the four things to click, in the room's Tab order", () => {
    expect(HOLO_TAGS.map((t) => t.id)).toEqual(["shelf", "machine", "bench", "wall"]);
  });

  it("each rise from an emitter on its own object, up to the label", () => {
    for (const t of HOLO_TAGS) expect(t.emitter.y, t.id).toBeLessThan(beamEnd(t).y);
    const bench = holoTag("bench");
    expect(bench.emitter.y).toBeCloseTo(3.335 + BENCH_PIVOT.position[1], 1);
    expect(xz(bench.emitter, BENCH_PIVOT.position)).toBeLessThan(3.5);
    const machine = holoTag("machine");
    expect(machine.emitter.y).toBeCloseTo(4.91 + MACHINE_PIVOT.position[1], 1);
    expect(xz(machine.emitter, MACHINE_PIVOT.position)).toBeLessThan(4);
    const wall = holoTag("wall");
    expect(wall.emitter.y).toBeCloseTo(BOARDS[2], 2);
    expect(-wall.emitter.x).toBeGreaterThanOrEqual(WALL.inner - 0.01);
    expect(-wall.emitter.x).toBeLessThanOrEqual(WALL.outer);
    // The shelf: on the spiral's rim (its cartridges stand 4.07 m out from the axis).
    expect(Math.hypot(holoTag("shelf").emitter.x, holoTag("shelf").emitter.z)).toBeLessThan(4.7);
  });

  it("face the room view's camera, so their text reads square on", () => {
    for (const t of HOLO_TAGS) {
      const toEye = new THREE.Vector3(...HUB.position).sub(t.anchor).normalize();
      expect(panelNormal(t).dot(toEye), t.id).toBeGreaterThan(0.97);
    }
  });

  it("are as wide at rest as their number and title, wider for a longer title", () => {
    expect(restWidth("01", "The machine")).toBeGreaterThan(restWidth("01", "The wall"));
    for (const t of HOLO_TAGS) {
      expect(t.restW, t.id).toBeGreaterThan(100);
      expect(t.restW, t.id).toBeLessThan(LABEL.openW);
    }
  });
});

describe("the room view's holographic labels: on screen (1280×720)", () => {
  const cam = hubCamera();
  const rest = HOLO_TAGS.map((t) => ({ id: t.id, r: projectLabel(t, cam, 1280, 720, 0) }));
  const open = HOLO_TAGS.map((t) => ({ id: t.id, r: projectLabel(t, cam, 1280, 720, 1) }));

  it("are about a third of the old cards' size or less at rest, and still easy to read", () => {
    const card = 240 * 136;
    for (const { id, r } of rest) {
      expect(area(r) / card, id).toBeLessThan(0.36);
      // About the planned size on screen, so the 14 px title stays 14 px.
      expect(r.x1 - r.x0, id).toBeGreaterThan(holoTag(id).restW * 0.85);
      expect(r.y1 - r.y0, id).toBeGreaterThan(LABEL.restH * 0.85);
    }
  });

  it("stay in the view unfolded: under the hub bar, above Ask SANT, clear of the journey rail", () => {
    for (const { id, r } of open) {
      expect(r.x0, id).toBeGreaterThan(16);
      expect(r.x1, id).toBeLessThan(1140);
      expect(r.y0, id).toBeGreaterThan(72);
      expect(r.y1, id).toBeLessThan(600);
    }
  });

  it("never cover the thing they label, even unfolded (the shelf's stays clear of the cartridges)", () => {
    for (const { id, r } of open) expect(apart(r, screenBox(objectPoints(id), cam, 1280, 720), 2), id).toBe(true);
  });

  it("don't overlap each other, at rest or when one unfolds", () => {
    for (let i = 0; i < HOLO_TAGS.length; i++)
      for (let j = 0; j < HOLO_TAGS.length; j++) {
        if (i === j) continue;
        expect(apart(rest[i].r, rest[j].r), `${rest[i].id} / ${rest[j].id}`).toBe(true);
        expect(apart(open[i].r, rest[j].r), `${open[i].id} unfolded / ${rest[j].id}`).toBe(true);
      }
  });

  it("have a short beam from the emitter to the label's left edge", () => {
    for (const t of HOLO_TAGS) {
      const a = t.emitter.clone().project(cam);
      const b = beamEnd(t).project(cam);
      const len = Math.hypot((a.x - b.x) * 640, (a.y - b.y) * 360);
      expect(len, t.id).toBeGreaterThan(16);
      expect(len, t.id).toBeLessThan(120);
    }
  });
});

describe("the room view's holographic labels: one geometry for all four", () => {
  it("holds each label (its unfolded quad, with its rest size), its beam and its emitter", () => {
    const g = buildHoloGeometry(HOLO_TAGS);
    const pos = g.getAttribute("position");
    const kind = g.getAttribute("aKind");
    const tag = g.getAttribute("aTag");
    const uv = g.getAttribute("uv");
    const rest = g.getAttribute("aRest");
    HOLO_TAGS.forEach((t, i) => {
      const of = (k: number) => [...Array(pos.count).keys()].filter((v) => tag.getX(v) === i && kind.getX(v) === k);
      const panel = of(KIND.panel);
      expect(panel).toHaveLength(4);
      const corners = boxCorners(t, LABEL.openW, LABEL.openH);
      panel.forEach((v, c) => expect(new THREE.Vector3().fromBufferAttribute(pos, v).distanceTo(corners[c])).toBeLessThan(1e-6));
      for (const v of panel) {
        // Its atlas row: the row's bottom and top v.
        expect(uv.getX(v)).toBeCloseTo(1 - (i + 1) / HOLO_TAGS.length, 9);
        expect(uv.getY(v)).toBeCloseTo(1 - i / HOLO_TAGS.length, 9);
        expect(rest.getX(v)).toBeCloseTo(t.restW / LABEL.openW, 6);
        expect(rest.getY(v)).toBeCloseTo(LABEL.restH / LABEL.openH, 6);
      }
      const cone = of(KIND.cone);
      expect(cone).toHaveLength(3);
      expect(cone.some((v) => new THREE.Vector3().fromBufferAttribute(pos, v).distanceTo(t.emitter) < 1e-6)).toBe(true);
      const disc = of(KIND.emitter);
      expect(disc).toHaveLength(4);
      for (const v of disc) expect(pos.getY(v)).toBeCloseTo(t.emitter.y + 0.02, 6);
    });
    expect(g.index).not.toBeNull();
  });
});

describe("the room view's holographic labels: when, and the hover state", () => {
  it("are holograms in 3D on high and ultra at desktop widths; the HTML cards otherwise", () => {
    const base = { mode: "3d", tier: "high", reduced: false, width: 1280 } as const;
    expect(holoMode(base)).toBe(true);
    expect(holoMode({ ...base, tier: "ultra" })).toBe(true);
    expect(holoMode({ ...base, tier: "low" })).toBe(false);
    expect(holoMode({ ...base, reduced: true })).toBe(false);
    expect(holoMode({ ...base, mode: "stills" })).toBe(false);
    expect(holoMode({ ...base, width: 390 })).toBe(false);
  });

  it("light the hovered or focused label, and tell the 3D once per change", () => {
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
