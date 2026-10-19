// What sits where on the spiral, shared by the cartridges (Helix.tsx), the camera (the workshop's
// steps), the filters, the detail view and the machine (which flies the chosen one in). Mutated in
// place, like plug.ts; React hears about the coarse changes (filter, selection) through `subscribe`.
//
// The jobs (items.ts) fill the spiral from near the top: display step d sits in HELIX slot ITEM_TOP - d,
// so scrolling down the spiral steps through them one at a time. The three highest slots reach up
// through the ceiling's opening, so the robots take those and the two lowest (where the machine's
// default plug-in takes the SO-101 from slot 0).
// A filter reorders the jobs: the matches slide along the helix to the top slots in ITEMS order, the
// rest follow, dimmed, and the scroll stops at the last match.
import * as THREE from "three";
import type { Cartridge } from "../core/types";
import { HELIX } from "./layout";
import { ITEMS, TAG_SHELL, type TagId } from "./items";

export const N_ITEMS = ITEMS.length;
/** The highest slot a job takes: the top of its cartridge stays under the 14.4 m ceiling. */
export const ITEM_TOP = HELIX.length - 4;
/** The helix slot of display step d (0 at the top). */
export const stepSlot = (d: number) => ITEM_TOP - d;
/** The robots' slots: the ones the jobs don't take. */
export const ROBOT_SLOTS = HELIX.map((s) => s.index).filter((i) => i > ITEM_TOP || i <= ITEM_TOP - N_ITEMS);

export const spiral = {
  filter: null as TagId | null,
  /** Per item: its display step now (fractional while it slides) and where it is going. */
  pos: Float32Array.from(ITEMS, (_, i) => i),
  target: Float32Array.from(ITEMS, (_, i) => i),
  /** The step the scroll is on (the front cartridge), fractional between steps. */
  step: 0,
  /** The item under the pointer, or -1. */
  hover: -1,
  /** The item open in the detail view, or -1. */
  selected: -1,
};

const fns = new Set<() => void>();
export function subscribeSpiral(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
export const notifySpiral = () => fns.forEach((fn) => fn());

export const matches = (i: number, filter: TagId | null = spiral.filter) => filter === null || ITEMS[i].tag === filter;

/** Display order for a filter: the matches first, then the rest, each in ITEMS order. */
export function orderFor(filter: TagId | null): number[] {
  const all = ITEMS.map((_, i) => i);
  return [...all.filter((i) => matches(i, filter)), ...all.filter((i) => !matches(i, filter))];
}

/** How many steps the scroll may take: the matches with a filter on, else every job. */
export const stepCount = (filter: TagId | null = spiral.filter) => (filter === null ? N_ITEMS : ITEMS.filter((it) => it.tag === filter).length);

export function setFilter(tag: TagId | null): void {
  spiral.filter = tag;
  orderFor(tag).forEach((item, d) => (spiral.target[item] = d));
  notifySpiral();
}

export function setHover(i: number): void {
  if (spiral.hover === i) return;
  spiral.hover = i;
  notifySpiral();
}

export function setSelected(i: number): void {
  if (spiral.selected === i) return;
  spiral.selected = i;
  notifySpiral();
}

/** The item at display step d (where it is going), or -1. */
export function itemAtStep(d: number): number {
  const k = Math.round(d);
  for (let i = 0; i < N_ITEMS; i++) if (spiral.target[i] === k) return i;
  return -1;
}

/** The helix slot an item is going to. */
export const slotOfItem = (i: number) => stepSlot(spiral.target[i]);

/** The item going to a helix slot, or -1 (a robot slot). */
export function itemInSlot(slot: number): number {
  const d = ITEM_TOP - slot;
  return d >= 0 && d < N_ITEMS ? itemAtStep(d) : -1;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** The pose at fractional display step d: between two helix slots, lerped and slerped. */
export function stepPose(d: number, outP = new THREE.Vector3(), outQ = new THREE.Quaternion()): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const c = Math.min(N_ITEMS - 1, Math.max(0, d));
  const i0 = Math.floor(c);
  const i1 = Math.min(N_ITEMS - 1, i0 + 1);
  const u = c - i0;
  const s0 = HELIX[stepSlot(i0)];
  const s1 = HELIX[stepSlot(i1)];
  outP.copy(_a.set(...s0.position)).lerp(_b.set(...s1.position), u);
  outQ.copy(_qa.set(...s0.quaternion)).slerp(_qb.set(...s1.quaternion), u);
  return { position: outP, quaternion: outQ };
}

/** An item's shell tint in linear RGB. */
export function itemShell(i: number, out = new THREE.Color()): THREE.Color {
  return out.set(TAG_SHELL[ITEMS[i].tag]);
}

export function resetSpiral(): void {
  spiral.filter = null;
  spiral.pos = Float32Array.from(ITEMS, (_, i) => i);
  spiral.target = Float32Array.from(ITEMS, (_, i) => i);
  spiral.step = 0;
  spiral.hover = -1;
  spiral.selected = -1;
}

/** The cartridge the machine gets for a job: what it projects and the route the zoom opens. */
export function cartridgeOfItem(i: number): Cartridge {
  const it = ITEMS[i];
  return { id: it.id, label: it.title, route: it.route, slot: slotOfItem(i) };
}
