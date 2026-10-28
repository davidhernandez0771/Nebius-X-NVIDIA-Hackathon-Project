// The cartridges made on the workbench: a name, a shell (a finish and a colour) and a robot each, kept
// in localStorage and stood in the spiral's empty places (layout.ts SPARE), oldest lowest. Mutated
// through these functions only; the spiral, the label atlas and the bench hear about changes through
// `subscribeSaved`.
import type { Cartridge } from "../core/types";
import { HELIX, SPARE } from "./layout";
import { ROBOTS, cartridgeAt } from "./robots";

/**
 * The six blank shells on the bench, one per finish: how the surface takes the light (roughness,
 * metalness, see-through), the pattern drawn into it (shellSurface.ts) and the colour the blank comes in.
 */
export const FINISHES = [
  { id: "matte", name: "Matte", color: "#323336", roughness: 0.92, metalness: 0, opacity: 1, surface: "none" },
  { id: "brushed", name: "Brushed metal", color: "#a7acb1", roughness: 0.34, metalness: 0.92, opacity: 1, surface: "brushed" },
  { id: "gloss", name: "Glossy", color: "#16181b", roughness: 0.06, metalness: 0, opacity: 1, surface: "none" },
  { id: "clear", name: "Translucent", color: "#5d6268", roughness: 0.12, metalness: 0, opacity: 0.55, surface: "none" },
  { id: "carbon", name: "Carbon", color: "#25272a", roughness: 0.38, metalness: 0.15, opacity: 1, surface: "weave" },
  { id: "ceramic", name: "Ceramic", color: "#e2ddd0", roughness: 0.3, metalness: 0, opacity: 1, surface: "speckle" },
] as const;

export type FinishId = (typeof FINISHES)[number]["id"];
export type Finish = (typeof FINISHES)[number];
export type Surface = Finish["surface"];

export const finishOf = (id: FinishId | null): Finish => FINISHES.find((f) => f.id === id) ?? FINISHES[0];
const isFinish = (v: unknown): v is FinishId => FINISHES.some((f) => f.id === v);

/** The colour stage's swatches (sRGB). Any other colour comes from the free picker. */
export const COLOURS = [
  { id: "graphite", name: "Graphite", hex: "#323336" },
  { id: "bone", name: "Bone", hex: "#e2ddd0" },
  { id: "ash", name: "Ash", hex: "#9da2a6" },
  { id: "signal", name: "Signal", hex: "#2bb39a" },
  { id: "amber", name: "Amber", hex: "#e8a33d" },
  { id: "ember", name: "Ember", hex: "#d4503a" },
  { id: "cobalt", name: "Cobalt", hex: "#3b6fd8" },
  { id: "snow", name: "Snow", hex: "#f2f1ec" },
] as const;

/** A colour as it is kept: #rrggbb, lower case; anything else is null. */
export function cleanColour(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

/** The first bench's five shell plastics: what its saved cartridges kept still reads back (parseSaved). */
const SHELLS = [
  { id: "graphite", hex: "#323336" },
  { id: "smoke", hex: "#5d6268" },
  { id: "bone", hex: "#e2ddd0" },
  { id: "ash", hex: "#9da2a6" },
  { id: "signal", hex: "#2bb39a" },
] as const;

const isRobot = (v: unknown): v is string => ROBOTS.some((r) => r.code === v);

export interface SavedCartridge {
  id: string;
  name: string;
  finish: FinishId;
  /** #rrggbb. */
  color: string;
  /** The robot's label code (robots.ts). */
  robot: string;
  savedAt: number;
}

export interface Draft {
  name: string;
  /** null until a blank is picked off the bench. */
  finish: FinishId | null;
  color: string;
  robot: string;
}

/** One saved cartridge per empty place on the spiral. */
export const MAX_SAVED = SPARE.length;
/** The longest name the label still prints at a readable size. */
export const NAME_MAX = 16;
export const STORAGE_KEY = "world.bench.v1";

/** A name as it is kept: no control characters, single spaces, trimmed, at most NAME_MAX. */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}

/** What localStorage held, keeping only well-formed entries (at most MAX_SAVED). */
export function parseSaved(raw: string | null): SavedCartridge[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedCartridge[] = [];
  for (const d of data) {
    if (!d || typeof d !== "object") continue;
    const { id, name, finish, color, shell, robot, savedAt } = d as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !cleanName(name) || !isRobot(robot)) continue;
    // The first bench kept a named plastic: its colour on Matte (Smoke was the see-through one).
    const old = finish === undefined && color === undefined ? SHELLS.find((s) => s.id === shell) : undefined;
    const look = old ? { finish: old.id === "smoke" ? "clear" : "matte", color: old.hex } : { finish, color: cleanColour(color) };
    if (!isFinish(look.finish) || !look.color) continue;
    out.push({ id, name: cleanName(name), finish: look.finish, color: look.color, robot, savedAt: typeof savedAt === "number" ? savedAt : 0 });
    if (out.length === MAX_SAVED) break;
  }
  return out;
}

let list: SavedCartridge[] | null = null;
const fns = new Set<() => void>();

function load(): SavedCartridge[] {
  try {
    return parseSaved(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function store(next: SavedCartridge[]): void {
  list = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode or full: they stay for this visit */
  }
  fns.forEach((fn) => fn());
}

/** The saved cartridges, oldest first: place i is SPARE[i]. */
export function savedCartridges(): readonly SavedCartridge[] {
  if (!list) list = load();
  return list;
}

export function subscribeSaved(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

export type SaveResult = { ok: true; cartridge: SavedCartridge; place: number } | { ok: false; reason: "name" | "full" };

export function saveCartridge(draft: Draft): SaveResult {
  const name = cleanName(draft.name);
  if (!name) return { ok: false, reason: "name" };
  const now = savedCartridges();
  if (now.length >= MAX_SAVED) return { ok: false, reason: "full" };
  const cartridge: SavedCartridge = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    finish: isFinish(draft.finish) ? draft.finish : FINISHES[0].id,
    color: cleanColour(draft.color) ?? FINISHES[0].color,
    robot: isRobot(draft.robot) ? draft.robot : ROBOTS[0].code,
    savedAt: Date.now(),
  };
  store([...now, cartridge]);
  return { ok: true, cartridge, place: now.length };
}

export function removeSaved(id: string): void {
  const now = savedCartridges();
  if (now.some((c) => c.id === id)) store(now.filter((c) => c.id !== id));
}

/** The spiral slot number of place i. */
export const savedSlot = (place: number) => HELIX.length + place;

/** The saved cartridge standing in a spiral slot, or null. */
export function savedInSlot(slot: number): SavedCartridge | null {
  return savedCartridges()[slot - HELIX.length] ?? null;
}

/** What the machine gets for a saved cartridge: its name, and the robot's Record page. */
export function cartridgeOfSaved(c: SavedCartridge, place: number): Cartridge {
  return { id: `mine-${c.id}`, label: c.name, route: "/pm/record", slot: savedSlot(place), robot: c.robot };
}

/** The cartridge in any spiral slot: a saved one by its place, else the helix slot's (robots.ts). */
export function cartridgeInSlot(slot: number): Cartridge {
  if (slot < HELIX.length) return cartridgeAt(HELIX[slot]);
  const c = savedInSlot(slot);
  if (!c) throw new Error(`world: spiral place ${slot} is empty`);
  return cartridgeOfSaved(c, slot - HELIX.length);
}

/** Forget what was read (tests; the next read goes back to localStorage). */
export function resetSaved(): void {
  list = null;
}
