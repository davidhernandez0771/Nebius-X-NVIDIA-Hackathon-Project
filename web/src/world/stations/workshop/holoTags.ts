// Where the room view's holographic labels stand (HubHolograms.tsx draws them), Active Theory style:
// small and quiet. At rest a label is one line, "01  THE SHELF", in corner brackets on see-through
// glass; on hover or focus it unfolds up and to the right (the title rises, its line appears under
// it). Each stands just above or beside its object, never over it, with a slim beam of light from a
// small emitter on the object to the label's bottom-left corner, which never moves. Labels face the room view's camera square on, and are sized from it in screen pixels at
// 1280×720. Pure, so the layout is tested, on screen too. Also here: when the labels are holograms
// at all (holoMode), and which one is hovered or focused.
import * as THREE from "three";
import type { TierName, WorldMode } from "../../core/quality";
import { CARTRIDGE_HALF } from "../../scene/cartridge";
import { BENCH_PIVOT, HELIX, MACHINE_PIVOT, stop } from "../../scene/layout";
import { BOARDS, WALL } from "../../scene/wallPlan";
import { DROP_ZONE } from "./drag";
import { HUB_TAGS, type HubItem } from "./hubItems";

/** A label's type and boxes, in screen pixels at 1280×720 from the room view. */
export const LABEL = {
  /** The title (bold, caps) and the number before it. */
  titlePx: 14,
  numPx: 11,
  /** Letter spacing (px) of the title and the number; Geist Mono advances 0.6 em per letter. */
  titleTrack: 1.4,
  numTrack: 1,
  advance: 0.6,
  padX: 10,
  /** The gap between the number and the title. */
  gap: 12,
  /** At rest: one line. */
  restH: 32,
  /** Unfolded: the title line and up to two lines under it. */
  openW: 248,
  openH: 76,
  /** The line under it. */
  linePx: 11,
} as const;

/** Canvas pixels per screen pixel: the text is drawn at 3×, sharp at 2× DPR too. */
export const SCALE = 3;
/** Each label's row of the text atlas. */
export const CANVAS = { w: LABEL.openW * SCALE, h: LABEL.openH * SCALE } as const;

/** A label's width at rest: its number and title on one line, padded (mono, so it is the letter count). */
export function restWidth(n: string, title: string): number {
  const num = n.length * (LABEL.numPx * LABEL.advance + LABEL.numTrack);
  const tit = title.length * (LABEL.titlePx * LABEL.advance + LABEL.titleTrack);
  return Math.ceil(LABEL.padX * 2 + num + LABEL.gap + tit);
}

export interface HoloTag {
  id: HubItem;
  /** Where its light starts: on the object. */
  emitter: THREE.Vector3;
  /** The label's bottom-left corner; it grows right and up from here. */
  anchor: THREE.Vector3;
  /** Metres per screen pixel at the label (at 1280×720 from the room view). */
  mPerPx: number;
  /** Its width at rest (px; its height at rest is LABEL.restH). */
  restW: number;
  /** The label's turn: its +z faces the room view's camera. */
  quaternion: THREE.Quaternion;
}

const HUB = stop("Workshop intro");
const EYE = new THREE.Vector3(...HUB.position);
const AHEAD = new THREE.Vector3(...HUB.target).sub(EYE).normalize();
/** Pixels per metre at 1 m in front of the room view's camera, on a 720 px tall screen. */
const FOCAL = 360 / Math.tan(((HUB.fov / 2) * Math.PI) / 180);
const UP = new THREE.Vector3(0, 1, 0);

const local = (p: readonly number[], x: number, y: number, z: number) => new THREE.Vector3(p[0] + x, p[1] + y, p[2] + z);

/** The emitters and the labels' bottom-left corners (world metres): each beside its object, not over it. */
const PLACES: { id: HubItem; emitter: THREE.Vector3; anchor: THREE.Vector3 }[] = [
  // The spiral: an emitter on its right-hand rim, the label off to the right of its upper turns.
  { id: "shelf", emitter: new THREE.Vector3(4.3, 10.4, 1.2), anchor: new THREE.Vector3(5.6, 10.6, 1.2) },
  // The machine: on its top, the label just over it.
  { id: "machine", emitter: local(MACHINE_PIVOT.position, -2.4, 4.91, 0.6), anchor: local(MACHINE_PIVOT.position, -3.0, 6.6, 0.6) },
  // The bench: on its top, the label just over it.
  { id: "bench", emitter: local(BENCH_PIVOT.position, -1.8, 3.335, 0.6), anchor: local(BENCH_PIVOT.position, -1.5, 5.4, 0.6) },
  // The wall: on the front edge of the left wall's top board, the label on the wall over its robots.
  { id: "wall", emitter: new THREE.Vector3(-WALL.inner, BOARDS[2], -9), anchor: new THREE.Vector3(-WALL.inner + 0.4, 9.2, -9) },
];

const _m = new THREE.Matrix4();

export const HOLO_TAGS: readonly HoloTag[] = PLACES.map(({ id, emitter, anchor }) => {
  const t = HUB_TAGS.find((h) => h.id === id)!;
  _m.lookAt(EYE, anchor, UP);
  return {
    id,
    emitter,
    anchor,
    mPerPx: anchor.clone().sub(EYE).dot(AHEAD) / FOCAL,
    restW: restWidth(t.n, t.title),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(_m),
  };
});

export function holoTag(id: HubItem): HoloTag {
  const t = HOLO_TAGS.find((h) => h.id === id);
  if (!t) throw new Error(`world: no hub tag "${id}"`);
  return t;
}

/** The way a label faces (its +z). */
export const panelNormal = (t: HoloTag) => new THREE.Vector3(0, 0, 1).applyQuaternion(t.quaternion);

/** A label's box of w×h screen px up from its bottom-left: top left, top right, bottom right, bottom left. */
export function boxCorners(t: HoloTag, w: number, h: number): THREE.Vector3[] {
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(t.quaternion).multiplyScalar(w * t.mPerPx);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(t.quaternion).multiplyScalar(h * t.mPerPx);
  const bl = t.anchor.clone();
  return [bl.clone().add(u), bl.clone().add(u).add(r), bl.clone().add(r), bl];
}

/** The label's size: at rest, unfolded, or anywhere between (open 0–1). */
export function labelSize(t: HoloTag, open: number): { w: number; h: number } {
  const k = Math.min(1, Math.max(0, open));
  return { w: t.restW + (LABEL.openW - t.restW) * k, h: LABEL.restH + (LABEL.openH - LABEL.restH) * k };
}

/** Where the beam meets the label: its bottom-left corner (it stays put as the label unfolds). */
export function beamEnd(t: HoloTag): THREE.Vector3 {
  return t.anchor.clone();
}

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Points' box on screen (CSS px), from a camera. */
export function screenBox(points: readonly THREE.Vector3[], camera: THREE.Camera, w: number, h: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const c = p.clone().project(camera);
    const x = ((c.x + 1) / 2) * w;
    const y = ((1 - c.y) / 2) * h;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** A label's box on screen at `open` (0 at rest, 1 unfolded). */
export function projectLabel(t: HoloTag, camera: THREE.Camera, w: number, h: number, open = 0): Rect {
  const s = labelSize(t, open);
  return screenBox(boxCorners(t, s.w, s.h), camera, w, h);
}

/** The corners of a turned box (centre, half sizes, yaw). */
function boxPoints(c: THREE.Vector3, half: THREE.Vector3, yaw: number): THREE.Vector3[] {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const out: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(new THREE.Vector3(x * half.x, y * half.y, z * half.z).applyQuaternion(q).add(c));
  return out;
}

/**
 * What each label must not cover, as points whose screen box is the object: the spiral's cartridges,
 * the machine, the bench, the robots on the wall's middle shelf.
 */
export function objectPoints(id: HubItem): THREE.Vector3[] {
  if (id === "shelf") {
    const r = Math.hypot(CARTRIDGE_HALF[0], CARTRIDGE_HALF[2]);
    const half = new THREE.Vector3(r, CARTRIDGE_HALF[1], r);
    return HELIX.flatMap((s) => boxPoints(new THREE.Vector3(...s.position), half, 0));
  }
  if (id === "machine") return boxPoints(DROP_ZONE.center, DROP_ZONE.half, DROP_ZONE.yaw);
  if (id === "bench") return boxPoints(local(BENCH_PIVOT.position, 0, 2.0, 0), new THREE.Vector3(3.5, 2.25, 2), BENCH_PIVOT.yaw);
  return boxPoints(
    new THREE.Vector3(-(WALL.inner + WALL.outer) / 2, BOARDS[1] + 1.4, (WALL.z[0] + WALL.z[1]) / 2),
    new THREE.Vector3((WALL.outer - WALL.inner) / 2, 1.4, (WALL.z[1] - WALL.z[0]) / 2),
    0,
  );
}

// ---------------------------------------------------------------- one geometry for all four

/** What a vertex belongs to (the aKind attribute): the label, its beam, its emitter. */
export const KIND = { panel: 0, cone: 1, emitter: 2 } as const;
/** The emitter disc's radius (metres) and how far over the object it floats, against z-fighting. */
const DISC_R = 0.32;
const DISC_LIFT = 0.02;
/** The beam is this many px tall where it meets the label. */
const BEAM_PX = 8;

/**
 * Every label, beam and emitter in one indexed geometry (one draw call, HubHolograms.tsx), in world
 * space. The label's quad is its unfolded size, up from its bottom-left; the shader shows only the
 * part `open` uncovers, and reads the atlas from the top of that part (the title). Attributes: uv
 * (the label's row of the text atlas, tag i in row i from the top: x across, y the row's bottom and
 * top v); aLocal (the label: 0–1 right and 0–1 up; the beam: x across over y along, so x/y is −1–1
 * across it; the disc: −1–1); aRest (the label's rest size over its unfolded size); aKind; aTag.
 */
export function buildHoloGeometry(tags: readonly HoloTag[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const loc: number[] = [];
  const rest: number[] = [];
  const kind: number[] = [];
  const tag: number[] = [];
  const index: number[] = [];
  const add = (p: THREE.Vector3, u: number, v: number, lx: number, ly: number, k: number, t: number, rw = 0, rh = 0) => {
    pos.push(p.x, p.y, p.z);
    uv.push(u, v);
    loc.push(lx, ly);
    rest.push(rw, rh);
    kind.push(k);
    tag.push(t);
    return pos.length / 3 - 1;
  };
  const rows = tags.length;
  tags.forEach((t, i) => {
    const [tl, tr, br, bl] = boxCorners(t, LABEL.openW, LABEL.openH);
    const v0 = 1 - (i + 1) / rows;
    const v1 = 1 - i / rows;
    const rw = t.restW / LABEL.openW;
    const rh = LABEL.restH / LABEL.openH;
    const a = add(tl, v0, v1, 0, 1, KIND.panel, i, rw, rh);
    add(tr, v0, v1, 1, 1, KIND.panel, i, rw, rh);
    add(br, v0, v1, 1, 0, KIND.panel, i, rw, rh);
    add(bl, v0, v1, 0, 0, KIND.panel, i, rw, rh);
    index.push(a, a + 3, a + 2, a, a + 2, a + 1);
    // The beam: a slim wedge from the emitter to the label's bottom-left corner.
    const end = beamEnd(t);
    const half = new THREE.Vector3(1, 0, 0).applyQuaternion(t.quaternion).multiplyScalar((BEAM_PX / 2) * t.mPerPx);
    const c = add(t.emitter, 0, 0, 0, 0, KIND.cone, i);
    add(end.clone().add(half), 0, 0, -1, 1, KIND.cone, i);
    add(end.clone().sub(half), 0, 0, 1, 1, KIND.cone, i);
    index.push(c, c + 1, c + 2);
    // The emitter: a small disc lying on the object.
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
  g.setAttribute("aRest", new THREE.Float32BufferAttribute(rest, 2));
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
