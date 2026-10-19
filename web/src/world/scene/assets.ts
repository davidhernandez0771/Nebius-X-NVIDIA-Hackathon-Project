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
export const CARTRIDGE_LOD_URL = `${BASE}models/cartridge_lod.glb`;
export const MACHINE_URL = `${BASE}models/machine.glb`;

/** Everything the workshop and the machine load, so the lamps can count it in. */
export const ALL_MODELS = [...BAKED.map(bakedUrl), CARTRIDGE_URL, CARTRIDGE_LOD_URL, MACHINE_URL];

export const STILLS: Record<StationId, string> = {
  intro: `${BASE}stills/story.webp`,
  descent: `${BASE}stills/descent.webp`,
  workshop: `${BASE}stills/workshop.webp`,
  machine: `${BASE}stills/machine.webp`,
  zoom: `${BASE}stills/zoom.webp`,
  workbench: `${BASE}stills/workbench.webp`,
};
