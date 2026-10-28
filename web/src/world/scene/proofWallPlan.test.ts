// The proof wall (proof-wall, 2026-10-26, the user): a lit results board on the workshop's back wall, left of the
// spiral, that shows "0/40 → 30/40" and the climb from the room view, and opens as a place. Where it hangs, what it
// shows (every number from proofData), what it costs (two meshes, one small canvas) and the camera that faces it.
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitFov } from "../core/fov";
import { CLIMB, CLIMB_FOOTNOTE_SHORT, GOAL, LEAD } from "../../site/results/proofData";
import { CLIMB_HEAD } from "../ui/proofFigures";
import proof, { PROOF_VIEW, PROOF_VIEW_PORTRAIT } from "../stations/proof";
import { SCREEN_IN_VH } from "../stations/proof/view";
import { HOLO_TAGS, objectPoints, projectLabel, screenBox, type Rect } from "../stations/workshop/holoTags";
import { BLOCKS, ROOM, SPIRAL_R } from "./collide";
import { stop } from "./layout";
import { PROOF_BOARD, PROOF_TEX, PROOF_WALL, drawFace, faceRegion, makeProofWall, proofFace, wallCorners } from "./proofWallPlan";
import { WALL } from "./wallPlan";

const HUB = stop("Workshop intro");
function camera(view: { position: readonly number[]; target: readonly number[]; fov: number }, w = 1280, h = 720) {
  const c = new THREE.PerspectiveCamera(fitFov(view.fov, w / h), w / h, 0.1, 220);
  c.position.set(view.position[0], view.position[1], view.position[2]);
  c.lookAt(view.target[0], view.target[1], view.target[2]);
  c.updateMatrixWorld(true);
  return c;
}
const apart = (a: Rect, b: Rect, gap = 0) => a.x1 + gap < b.x0 || b.x1 + gap < a.x0 || a.y1 + gap < b.y0 || b.y1 + gap < a.y0;

/** A 2D context that records what is written, for the face's words and numbers (jsdom has no canvas). */
function recorder() {
  const texts: string[] = [];
  const noop = () => {};
  const g = new Proxy(
    { texts, measureText: (s: string) => ({ width: s.length * 10 }), fillText: (s: string) => texts.push(s), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) },
    { get: (t, k) => (k in t ? t[k as keyof typeof t] : noop), set: () => true },
  );
  return { g: g as unknown as CanvasRenderingContext2D, texts };
}

afterEach(() => vi.restoreAllMocks());

describe("the proof wall: where it hangs", () => {
  const [x0, x1] = [PROOF_WALL.center[0] - PROOF_WALL.width / 2, PROOF_WALL.center[0] + PROOF_WALL.width / 2];
  const [y0, y1] = [PROOF_WALL.center[1] - PROOF_WALL.height / 2, PROOF_WALL.center[1] + PROOF_WALL.height / 2];
  const z = PROOF_WALL.center[2];

  it("hangs on the back wall's free board (left of the spiral), in front of its raised glyphs, inside its edge", () => {
    expect(z).toBeGreaterThan(PROOF_BOARD.glyphs);
    expect(z - PROOF_BOARD.glyphs).toBeLessThan(0.15);
    expect(x0).toBeGreaterThan(PROOF_BOARD.x[0]);
    expect(x1).toBeLessThan(PROOF_BOARD.x[1]);
    expect(y0).toBeGreaterThan(PROOF_BOARD.y[0]);
    expect(y1).toBeLessThan(PROOF_BOARD.y[1]);
    // Square to the room: it faces +z, toward the room view.
    expect(PROOF_WALL.normal).toEqual([0, 0, 1]);
    // A large display: wider than the bench, taller than a person standing on a desk.
    expect(PROOF_WALL.width).toBeGreaterThan(10);
    expect(PROOF_WALL.height).toBeGreaterThan(5);
  });

  it("is clear of everything that moves or stands in the room: the spiral and its lift, the arm's mast, the bench, the machine, the side walls' shelves", () => {
    // Behind where a carried cartridge may go (collide.ts ROOM), so nothing the arm carries reaches it.
    expect(z).toBeLessThan(ROOM.z[0]);
    // The spiral rises straight up round its axis (lift.ts): the wall is far from that column at every height.
    const nearest = Math.hypot(Math.min(Math.abs(x0), Math.abs(x1)), z);
    expect(nearest).toBeGreaterThan(SPIRAL_R + 10);
    // The desks, the machine, the bench's printer: none comes within 10 m of it.
    for (const b of BLOCKS) {
      const reach = Math.hypot(b.half[0], b.half[1]);
      const dx = Math.max(x0 - b.center[0], 0, b.center[0] - x1);
      const dz = Math.abs(b.center[1] - z);
      expect(Math.hypot(dx, dz) - reach, b.name).toBeGreaterThan(10);
    }
    // The side walls' shelves start at |x| 20 and stop at z −15; the wall is between them and further back.
    expect(x0).toBeGreaterThan(-WALL.inner);
    expect(z).toBeLessThan(WALL.z[0]);
    expect(y1).toBeLessThan(ROOM.ceiling);
  });
});

describe("the proof wall: what it shows", () => {
  it("leads with 0/40 → 30/40 and draws the climb's four rows and the goal, all from proofData", () => {
    const face = proofFace();
    expect(face.head).toBe(CLIMB_HEAD);
    expect(face.head).toBe(`${CLIMB[0].k}/${CLIMB[0].n} → ${CLIMB[3].k}/${CLIMB[3].n}`);
    expect(face.rows.map((r) => [r.tag, r.k, r.n])).toEqual(CLIMB.map((s) => [s.tag, s.k, s.n]));
    expect(face.rows.filter((r) => r.hi).map((r) => r.tag)).toEqual(["v2"]);
    expect(face.goal).toEqual({ k: GOAL.k, n: GOAL.n });
    expect(face.line).toBe(LEAD.headline);
    const { g, texts } = recorder();
    drawFace(g, face);
    const all = texts.join(" | ");
    expect(all).toContain(`${CLIMB[0].k}/${CLIMB[0].n}`);
    expect(all).toContain(`${CLIMB[3].k}/${CLIMB[3].n}`);
    for (const s of CLIMB) {
      expect(texts).toContain(s.tag.toUpperCase());
      expect(texts).toContain(`${s.k}/${s.n}`);
    }
    expect(all).toContain(`${GOAL.k}/${GOAL.n}`);
    expect(all).toContain(LEAD.headline.toUpperCase());
    expect(all).toContain(CLIMB_FOOTNOTE_SHORT.toUpperCase());
  });

  it("is a landmark from the room view: the headline and the climb in view, under the hub bar, left of the spiral, clear of every tag", () => {
    const cam = camera(HUB);
    const shelf = screenBox(objectPoints("shelf"), cam, 1280, 720);
    for (const part of ["head", "graph"] as const) {
      const r = screenBox(faceRegion(part), cam, 1280, 720);
      expect(r.x0, part).toBeGreaterThan(16);
      expect(r.y0, part).toBeGreaterThan(72);
      expect(r.y1, part).toBeLessThan(600);
      // Not behind the spiral: its words end before the spiral's cartridges begin.
      expect(r.x1, part).toBeLessThan(shelf.x0);
      // Big enough to read: the headline's figures stand taller than the hub tags' 14 px titles' capitals.
      if (part === "head") expect(r.y1 - r.y0).toBeGreaterThan(12);
      for (const t of HOLO_TAGS) expect(apart(r, projectLabel(t, cam, 1280, 720, 0), 2), `${part} / ${t.id}`).toBe(true);
    }
  });
});

describe("the proof wall: what it costs", () => {
  it("is two meshes (the screen and the light it spills on the wall), two triangles each, one 1024×512 face", () => {
    const { g } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(g as never);
    const wall = makeProofWall();
    const meshes: THREE.Mesh[] = [];
    wall.group.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      const geo = m.geometry;
      expect((geo.index ? geo.index.count : geo.getAttribute("position").count) / 3).toBe(2);
      // Plain built-in materials: they materialize with the room and follow its lamps (Materialize, power.ts).
      expect((m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial).toBe(true);
      expect((m.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    }
    expect(PROOF_TEX).toEqual({ w: 1024, h: 512 });
    const img = wall.map.image as HTMLCanvasElement;
    expect([img.width, img.height]).toEqual([PROOF_TEX.w, PROOF_TEX.h]);
    // The spill's own texture is tiny.
    const spill = (meshes.find((m) => m !== wall.screen)!.material as THREE.MeshBasicMaterial).map!.image as HTMLCanvasElement;
    expect(spill.width * spill.height).toBeLessThanOrEqual(128 * 64);
    // Only the screen takes the pointer (a click opens the place).
    const hits: THREE.Intersection[] = [];
    wall.halo.raycast(new THREE.Raycaster(new THREE.Vector3(-11, 6.9, 0), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
    wall.dispose();
  });

  it("goes blank (glass and frame, no words) while the place's panels lie over it, and shows its face again after", () => {
    const { g, texts } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(g as never);
    const wall = makeProofWall();
    const face = texts.length;
    expect(face).toBeGreaterThan(10);
    expect(wall.setBlank(true)).toBe(true);
    expect(texts.length).toBe(face);
    // Asked twice, it paints once.
    expect(wall.setBlank(true)).toBe(false);
    expect(wall.setBlank(false)).toBe(true);
    expect(texts.length).toBe(2 * face);
    wall.dispose();
  });

  it("puts its corners where PROOF_WALL says", () => {
    const c = wallCorners();
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(PROOF_WALL.width, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(PROOF_WALL.height, 6);
    for (const p of c) expect(p.z).toBeCloseTo(PROOF_WALL.center[2], 6);
  });
});

describe("the proof wall: the place's camera", () => {
  it("is a branch off the room view, with the room's still for the 2D fallback", () => {
    expect(proof.kind).toBe("branch");
    expect(proof.id).toBe("proof");
    expect(proof.title).toBe("Proof");
    expect(proof.still).toMatch(/workshop\.webp$/);
  });

  it("faces the wall square on and frames it, the screen across most of a 16:9 view", () => {
    expect(PROOF_VIEW.target).toEqual(PROOF_WALL.center);
    expect(PROOF_VIEW.position[0]).toBeCloseTo(PROOF_WALL.center[0], 6);
    expect(PROOF_VIEW.position[1]).toBeCloseTo(PROOF_WALL.center[1], 6);
    const r = screenBox(wallCorners(), camera(PROOF_VIEW), 1280, 720);
    expect((r.x1 - r.x0) / 1280).toBeGreaterThan(0.7);
    expect((r.x1 - r.x0) / 1280).toBeLessThan(0.9);
    expect(r.y0).toBeGreaterThan(0);
    expect(r.y1).toBeLessThan(720);
  });

  // The place's panel is laid over the screen from SCREEN_IN_VH (Place.tsx, proof.css): it must be where the camera
  // shows the screen, at any landscape size.
  it("shows the screen where the place lays its panel: centred, SCREEN_IN_VH tall and wide", () => {
    for (const [w, h] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ]) {
      const r = screenBox(wallCorners(), camera(PROOF_VIEW, w, h), w, h);
      expect(r.x1 - r.x0).toBeCloseTo(SCREEN_IN_VH.w * h, 0);
      expect(r.y1 - r.y0).toBeCloseTo(SCREEN_IN_VH.h * h, 0);
      expect((r.x0 + r.x1) / 2).toBeCloseTo(w / 2, 0);
      expect((r.y0 + r.y1) / 2).toBeCloseTo(h / 2, 0);
    }
  });

  it("stands back on a phone held upright, so the whole screen fits across", () => {
    const r = screenBox(wallCorners(), camera(PROOF_VIEW_PORTRAIT, 390, 844), 390, 844);
    expect(r.x0).toBeGreaterThan(0);
    expect(r.x1).toBeLessThan(390);
    // Clear of the spiral's column, and over the bench's top.
    expect(Math.hypot(PROOF_VIEW_PORTRAIT.position[0], PROOF_VIEW_PORTRAIT.position[2])).toBeGreaterThan(SPIRAL_R + 2);
    expect(PROOF_VIEW_PORTRAIT.position[1]).toBeGreaterThan(4);
  });
});
