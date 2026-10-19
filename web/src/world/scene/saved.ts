// The cartridges made on the workbench: a name, a shell and a robot each, kept in localStorage and
// stood in the spiral's empty places (layout.ts SPARE), oldest lowest. Mutated through these
// functions only; the spiral, the label atlas and the bench hear about changes through `subscribeSaved`.
import type { Cartridge } from "../core/types";
import { HELIX, SPARE } from "./layout";
import { ROBOTS, cartridgeAt } from "./robots";

/** The bench's five shell plastics (sRGB), as in the C-workbench render. */
export const SHELLS = [
  { id: "graphite", name: "Graphite", hex: "#323336" },
  { id: "smoke", name: "Smoke", hex: "#5d6268" },
  { id: "bone", name: "Bone", hex: "#e2ddd0" },
  { id: "ash", name: "Ash", hex: "#9da2a6" },
  { id: "signal", name: "Signal", hex: "#2bb39a" },
] as const;

export type ShellId = (typeof SHELLS)[number]["id"];

export const shellOf = (id: ShellId) => SHELLS.find((s) => s.id === id) ?? SHELLS[0];
const isShell = (v: unknown): v is ShellId => SHELLS.some((s) => s.id === v);
const isRobot = (v: unknown): v is string => ROBOTS.some((r) => r.code === v);

export interface SavedCartridge {
  id: string;
  name: string;
  shell: ShellId;
  /** The robot's label code (robots.ts). */
  robot: string;
  savedAt: number;
}

export interface Draft {
  name: string;
  shell: ShellId;
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
    const { id, name, shell, robot, savedAt } = d as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !cleanName(name) || !isShell(shell) || !isRobot(robot)) continue;
    out.push({ id, name: cleanName(name), shell, robot, savedAt: typeof savedAt === "number" ? savedAt : 0 });
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
    shell: isShell(draft.shell) ? draft.shell : "graphite",
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
  return { id: `mine-${c.id}`, label: c.name, route: "/pm/record", slot: savedSlot(place) };
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
