// Where the room view's holographic tags stand (HoloTags.tsx draws them): for each of the four things
// to click, a small emitter on the object itself, and a glass panel above it, turned square to the room
// view's camera so its text reads straight on. Sized from that camera so each panel is about as big on
// screen as the HTML card it replaces (1280×720). Pure, so the layout is tested, on screen too.
// Also here: when the tags are holograms at all (holoMode), and which one is hovered or focused.
import * as THREE from "three";
import type { TierName, WorldMode } from "../../core/quality";
import { BENCH_PIVOT, MACHINE_PIVOT, stop } from "../../scene/layout";
import { BOARDS, WALL } from "../../scene/wallPlan";
import type { HubItem } from "./hubItems";

/** The panel's size on a 1280×720 screen from the room view: the HTML card's (HubTags). */
export const PANEL_PX = { w: 240, h: 136 } as const;
/** Each panel's text is drawn into a canvas this size (about 3× the screen size: sharp at 2× DPR too). */
export const CANVAS = { w: 768, h: 436 } as const;
/** The title's font size in the canvas. */
export const TITLE_PX = 46;

export interface HoloTag {
  id: HubItem;
  /** Where its light starts: on the object. */
  emitter: THREE.Vector3;
  /** The panel's centre, and its size in metres. */
  center: THREE.Vector3;
  width: number;
  height: number;
  /** The panel's turn: its +z faces the room view's camera. */
  quaternion: THREE.Quaternion;
}

const HUB = stop("Workshop intro");
const EYE = new THREE.Vector3(...HUB.position);
const AHEAD = new THREE.Vector3(...HUB.target).sub(EYE).normalize();
/** Pixels per metre at 1 m in front of the room view's camera, on a 720 px tall screen. */
const FOCAL = 360 / Math.tan(((HUB.fov / 2) * Math.PI) / 180);
const UP = new THREE.Vector3(0, 1, 0);

const local = (p: readonly number[], x: number, y: number, z: number) => new THREE.Vector3(p[0] + x, p[1] + y, p[2] + z);

/** The emitters and the panels' centres (world metres). */
const PLACES: { id: HubItem; emitter: THREE.Vector3; center: THREE.Vector3 }[] = [
  // The spiral: an emitter on its front, the panel in front of its upper turns (clear of the cartridges).
  { id: "shelf", emitter: new THREE.Vector3(0, 8.4, 4.2), center: new THREE.Vector3(0, 11.0, 5.4) },
  // The machine: on its top, over the middle of its body.
  { id: "machine", emitter: local(MACHINE_PIVOT.position, 0, 4.91, 0), center: local(MACHINE_PIVOT.position, 0.2, 8.2, 0) },
  // The bench: on its top, behind the turntable, toward the spiral.
  { id: "bench", emitter: local(BENCH_PIVOT.position, 1.1, 3.335, -1.1), center: local(BENCH_PIVOT.position, 0, 7.1, -0.6) },
  // The wall: on the front edge of the left wall's top board.
  { id: "wall", emitter: new THREE.Vector3(-WALL.inner, BOARDS[2], -11), center: new THREE.Vector3(-16.4, 11.2, -11) },
];

const _m = new THREE.Matrix4();

export const HOLO_TAGS: readonly HoloTag[] = PLACES.map(({ id, emitter, center }) => {
  const depth = center.clone().sub(EYE).dot(AHEAD);
  _m.lookAt(EYE, center, UP);
  return {
    id,
    emitter,
    center,
    width: (PANEL_PX.w * depth) / FOCAL,
    height: (PANEL_PX.h * depth) / FOCAL,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(_m),
  };
});

export function holoTag(id: HubItem): HoloTag {
  const t = HOLO_TAGS.find((h) => h.id === id);
  if (!t) throw new Error(`world: no hub tag "${id}"`);
  return t;
}

/** The way a panel faces (its +z). */
export const panelNormal = (t: HoloTag) => new THREE.Vector3(0, 0, 1).applyQuaternion(t.quaternion);

/** A panel's corners: bottom left, bottom right, top right, top left. */
export function panelCorners(t: HoloTag): THREE.Vector3[] {
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(t.quaternion).multiplyScalar(t.width / 2);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(t.quaternion).multiplyScalar(t.height / 2);
  return [t.center.clone().sub(r).sub(u), t.center.clone().add(r).sub(u), t.center.clone().add(r).add(u), t.center.clone().sub(r).add(u)];
}

/** A panel's box on screen (CSS px), from a camera. */
export function projectPanel(t: HoloTag, camera: THREE.Camera, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of panelCorners(t)) {
    c.project(camera);
    const x = ((c.x + 1) / 2) * w;
    const y = ((1 - c.y) / 2) * h;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------- one geometry for all four

/** What a vertex belongs to (the aKind attribute): the glass panel, its light cone, its emitter. */
export const KIND = { panel: 0, cone: 1, emitter: 2 } as const;
/** The emitter disc's radius (metres) and how far over the object it floats, against z-fighting. */
const DISC_R = 0.55;
const DISC_LIFT = 0.02;
/** The cone meets the panel's lower edge this far in from each side. */
const CONE_INSET = 0.18;

/**
 * Every tag's panel, cone and emitter in one indexed geometry (one draw call, HubHolograms.tsx), in
 * world space. Attributes: uv (the panel's row of the text atlas, tag i in row i from the top); aLocal
 * (the panel: 0–1 across and up; the cone: x across over y up, so x/y is −1–1 across the beam; the disc:
 * −1–1); aKind; aTag.
 */
export function buildHoloGeometry(tags: readonly HoloTag[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const loc: number[] = [];
  const kind: number[] = [];
  const tag: number[] = [];
  const index: number[] = [];
  const add = (p: THREE.Vector3, u: number, v: number, lx: number, ly: number, k: number, t: number) => {
    pos.push(p.x, p.y, p.z);
    uv.push(u, v);
    loc.push(lx, ly);
    kind.push(k);
    tag.push(t);
    return pos.length / 3 - 1;
  };
  const rows = tags.length;
  tags.forEach((t, i) => {
    const [bl, br, tr, tl] = panelCorners(t);
    const v0 = 1 - (i + 1) / rows;
    const v1 = 1 - i / rows;
    const a = add(bl, 0, v0, 0, 0, KIND.panel, i);
    add(br, 1, v0, 1, 0, KIND.panel, i);
    add(tr, 1, v1, 1, 1, KIND.panel, i);
    add(tl, 0, v1, 0, 1, KIND.panel, i);
    index.push(a, a + 1, a + 2, a, a + 2, a + 3);
    // The cone: a fan from the emitter to the lower edge, inset from its ends.
    const left = bl.clone().lerp(br, CONE_INSET);
    const right = bl.clone().lerp(br, 1 - CONE_INSET);
    const c = add(t.emitter, 0, 0, 0, 0, KIND.cone, i);
    add(left, 0, 0, -1, 1, KIND.cone, i);
    add(right, 0, 0, 1, 1, KIND.cone, i);
    index.push(c, c + 1, c + 2);
    // The emitter: a disc lying on the object.
    const y = t.emitter.y + DISC_LIFT;
    const e = add(new THREE.Vector3(t.emitter.x - DISC_R, y, t.emitter.z - DISC_R), 0, 0, -1, -1, KIND.emitter, i);
    add(new THREE.Vector3(t.emitter.x + DISC_R, y, t.emitter.z - DISC_R), 0, 0, 1, -1, KIND.emitter, i);
    add(new THREE.Vector3(t.emitter.x + DISC_R, y, t.emitter.z + DISC_R), 0, 0, 1, 1, KIND.emitter, i);
    add(new THREE.Vector3(t.emitter.x - DISC_R, y, t.emitter.z + DISC_R), 0, 0, -1, 1, KIND.emitter, i);
    index.push(e, e + 1, e + 2, e, e + 2, e + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aLocal", new THREE.Float32BufferAttribute(loc, 2));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute("aTag", new THREE.Float32BufferAttribute(tag, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/**
 * Holograms only where they read well and cost nothing extra to keep: the 3D on high or ultra, full
 * motion, a desktop-wide screen. Otherwise (the stills, low, reduced motion, a phone) the HTML cards.
 */
export function holoMode(o: { mode: WorldMode; tier: TierName; reduced: boolean; width: number }): boolean {
  return o.mode === "3d" && o.tier !== "low" && !o.reduced && o.width >= 700;
}

// ---------------------------------------------------------------- hover and focus

/** Why a tag is lit: the pointer is over it, or it has keyboard focus (the HTML buttons over the panels). */
export type HotBy = "pointer" | "focus";
const hot = new Map<HubItem, Set<HotBy>>();
const fns = new Set<() => void>();

/** A tag lights while the pointer is over it or it has focus, and goes out when neither is left. */
export function setHot(id: HubItem, on: boolean, by: HotBy = "pointer"): void {
  const was = tagHot(id);
  const set = hot.get(id) ?? new Set<HotBy>();
  if (on) set.add(by);
  else set.delete(by);
  hot.set(id, set);
  if (tagHot(id) !== was) fns.forEach((fn) => fn());
}

export const tagHot = (id: HubItem) => (hot.get(id)?.size ?? 0) > 0;

export function subscribeHot(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
