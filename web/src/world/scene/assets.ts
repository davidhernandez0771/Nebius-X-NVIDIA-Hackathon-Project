// The workshop's files in web/public/world, exported from docs/design/blender/sant-cartridge.blend.
// - models/*.glb: the baked static pieces (one atlas each, already lit) and the live models;
// - stills/*.webp: one pre-rendered still per station, for the fallback without a usable GPU.
import type { StationId } from "../core/types";

const BASE = `${import.meta.env.BASE_URL}world/`;

/** The baked pieces: one mesh named `baked_<name>` each, in world coordinates. */
export const BAKED = ["room", "shelves", "pedestal", "bench", "desk", "machine_body"] as const;
export type BakedName = (typeof BAKED)[number];

export const bakedUrl = (name: BakedName) => `${BASE}models/${name}.glb`;
export const CARTRIDGE_URL = `${BASE}models/cartridge.glb`;
export const MACHINE_URL = `${BASE}models/machine.glb`;
/** The machine itself, v2 (scene/machineV2.ts); machine.glb still gives the hologram's screen. */
export const MACHINE_V2_URL = `${BASE}models/machine_v2.glb`;

/** The robot wall's parts are built in code (scene/wallParts.ts); it counts in under this name once they stand. */
export const ROBOT_WALL = "robot-wall";

/** Everything the workshop and the machine load, so the lamps can count it in. */
export const ALL_MODELS = [...BAKED.map(bakedUrl), CARTRIDGE_URL, ROBOT_WALL, MACHINE_URL, MACHINE_V2_URL];

export const STILLS: Record<StationId, string> = {
  intro: `${BASE}stills/story.webp`,
  descent: `${BASE}stills/descent.webp`,
  workshop: `${BASE}stills/workshop.webp`,
  machine: `${BASE}stills/machine.webp`,
  zoom: `${BASE}stills/zoom.webp`,
  workbench: `${BASE}stills/workbench.webp`,
  // No render of its own yet: the room's (the robot wall is in it, seen from the hub).
  robots: `${BASE}stills/workshop.webp`,
  // The same: the proof wall is on the room's back wall.
  proof: `${BASE}stills/workshop.webp`,
};
