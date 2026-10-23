// Which files each station's scene needs before it can stand, the order the background fetches them in
// (core/assets.ts), and where the visitor is waiting on some. The hero needs none (it is built in code),
// so the loader never waits on a file; the forest's crack and robots come first, then what the descent
// builds the workshop from, then the rest of the room. Pure, so it is tested.
import { BAKED, CARTRIDGE_URL, MACHINE_URL, MACHINE_V2_URL, bakedUrl } from "../scene/assets";
import { MODEL_IDS, robotModelUrl } from "../scene/robotModels";
import { EXTRA_ROBOTS } from "../scene/wallPlan";
import { CRACK_SLOT } from "../stations/intro/crackSlot";
import { ROBOT_TIERS, robotUrl } from "../stations/intro/forestRobots";
import { span } from "../stations/intro/storyPlan";
import type { TierName } from "./quality";
import type { StationId } from "./types";

const BASE = import.meta.env.BASE_URL ?? "/";

/** The forest's: the crack's model (not on the low tier, which keeps the procedural crack) and its robots. */
export function forestFiles(tier: TierName): string[] {
  const crack = tier === "low" ? [] : [`${BASE}${CRACK_SLOT.url}`];
  return [...crack, ...ROBOT_TIERS[tier].ids.map((id) => `${BASE}${robotUrl(id)}`)];
}

/** The descent builds the workshop out of the baked room and the machine. */
const descentFiles = (): string[] => [...BAKED.map(bakedUrl), MACHINE_V2_URL];

/** The robot wall's robots (the low tier leaves the extras out). */
const wallFiles = (tier: TierName): string[] => MODEL_IDS.filter((id) => tier !== "low" || !EXTRA_ROBOTS.includes(id)).map(robotModelUrl);

const uniq = (list: string[]) => [...new Set(list)];

/** What a station's scene needs before it mounts (the hero: nothing). */
export function stationFiles(id: StationId, tier: TierName): string[] {
  switch (id) {
    case "intro":
      return [];
    case "descent":
      return descentFiles();
    case "robots":
      return wallFiles(tier);
    case "workbench":
      return uniq([...BAKED.map(bakedUrl), CARTRIDGE_URL]);
    case "machine":
    case "zoom":
      return uniq([...BAKED.map(bakedUrl), CARTRIDGE_URL, MACHINE_URL, MACHINE_V2_URL]);
    case "workshop":
      return uniq([...descentFiles(), CARTRIDGE_URL, MACHINE_URL, ...wallFiles(tier)]);
  }
}

/** The background's order: as the journey reaches them. */
export function prefetchOrder(tier: TierName): string[] {
  return uniq([...forestFiles(tier), ...descentFiles(), CARTRIDGE_URL, MACHINE_URL, ...wallFiles(tier)]);
}

/** The rooms the builder mounts (core/rooms.ts), in the journey's order: the forest and the reactor inside
 *  the intro (not with reduced motion, which holds the hero), then the stations'. */
export function roomOrder(reduced: boolean): string[] {
  const later: StationId[] = ["descent", "workshop", "machine", "zoom", "workbench", "robots"];
  return [...(reduced ? [] : ["intro:places"]), ...later];
}

/** A room's files. */
export const roomFiles = (room: string, tier: TierName): string[] => (room === "intro:places" ? forestFiles(tier) : stationFiles(room as StationId, tier));

/** The room the visitor is in or reaching, or null (the hero). */
export function roomAt(id: StationId, vh: number, reduced: boolean): string | null {
  if (id !== "intro") return id;
  const [a] = span("sink");
  return reduced || vh < a ? null : "intro:places";
}

const LABEL: Record<StationId, string> = {
  intro: "the forest",
  descent: "the descent",
  workshop: "the workshop",
  machine: "the machine",
  zoom: "the machine",
  workbench: "the workbench",
  robots: "the robot wall",
};

/**
 * Whose scene must stand for a station to be ready (core/standing.ts): the intro waits on its places, the
 * robot wall on the workshop (the wall is in the workshop's scene) and the zoom on the machine (it plays out
 * of it). Neither of those two has a Scene of its own, so waiting on their own name never ended.
 */
export function standKey(id: StationId): string {
  if (id === "intro") return "intro:places";
  if (id === "robots") return "workshop";
  if (id === "zoom") return "machine";
  return id;
}

/**
 * What the visitor is waiting on where they are, or null: at the hero nothing; past the middle of the
 * sink, the forest's files (not with reduced motion, which holds the hero); at a later station its own.
 * `vh` is how far into the intro, in viewport heights.
 */
export function waitFor(id: StationId, vh: number, tier: TierName, reduced: boolean): { label: string; files: string[] } | null {
  if (id === "intro") {
    const [a, b] = span("sink");
    if (reduced || vh < (a + b) / 2) return null;
    return { label: LABEL.intro, files: forestFiles(tier) };
  }
  return { label: LABEL[id], files: stationFiles(id, tier) };
}
