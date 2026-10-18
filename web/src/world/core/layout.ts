// The few world facts two stations share. The machine (T7) draws its projection in PROJECTION and
// ends its dwell on MACHINE_VIEW; the zoom (core) starts from MACHINE_VIEW and dollies into
// PROJECTION. Change them here and both follow.
import type { CameraPose, Cartridge, Vec3 } from "./types";

/** The ground colour behind everything (Volt --sant-bg), also the canvas clear colour and fog. */
export const WORLD_BG = "#07090C";

export const MACHINE_ANCHOR: Vec3 = [6, 0, -1];

/** The hologram, local to MACHINE_ANCHOR: a 16:9 rectangle facing +z. */
export const PROJECTION = { center: [0, 3.1, 0.2] as Vec3, width: 3.2, height: 1.8 };

/** Where the machine's dwell ends and the zoom begins, local to MACHINE_ANCHOR. */
export const MACHINE_VIEW: CameraPose = { position: [0, 2.6, 6.5], target: [0, 2.1, 0], fov: 40 };

/** Camera distance at which PROJECTION's height exactly fills a `fov` degree view. */
export function fillDistance(fov: number, height = PROJECTION.height): number {
  return height / 2 / Math.tan((fov * Math.PI) / 360);
}

/** The 2D route the zoom opens when no cartridge was chosen. */
export const DEFAULT_CARTRIDGE: Cartridge = { id: "record", label: "Record", route: "/pm/record" };

/** A camera that holds one shot for the whole dwell. */
export const still =
  (pose: CameraPose) =>
  (): CameraPose =>
    pose;
