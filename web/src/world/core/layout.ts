// The few world facts two stations share, in the Blender workshop's coordinates (scene/layout.ts).
// The machine (T7) draws its projection in PROJECTION and ends its dwell on MACHINE_VIEW; the zoom
// (core) starts from MACHINE_VIEW and dollies into PROJECTION. Change them here and both follow.
import { MACHINE_PIVOT, stopFrom } from "../scene/layout";
import type { CameraPose, Cartridge, Vec3 } from "./types";

/** The ground colour behind everything (Volt --sant-bg), also the canvas clear colour and fog. */
export const WORLD_BG = "#07090C";

/** machine.glb's origin: the machine's desk, at the right of the spiral. */
export const MACHINE_ANCHOR: Vec3 = MACHINE_PIVOT.position;

/**
 * The hologram, local to MACHINE_ANCHOR: machine.glb's `mx_M_HoloScreen` (a unit plane scaled
 * 4.8 x 2.256, the aspect of the Record screenshot on it), standing up and turned with the machine,
 * so it faces `normal` rather than +z.
 */
export const PROJECTION = {
  center: [3.179, 9.19, -1.69] as Vec3,
  width: 4.8,
  height: 2.256,
  normal: [Math.sin(MACHINE_PIVOT.yaw), 0, Math.cos(MACHINE_PIVOT.yaw)] as Vec3,
};

/** Where the machine's dwell ends and the zoom begins (Blender's "Projection" stop), local to MACHINE_ANCHOR. */
export const MACHINE_VIEW: CameraPose = stopFrom(MACHINE_ANCHOR, "Projection");

/** Camera distance at which PROJECTION's height exactly fills a `fov` degree view. */
export function fillDistance(fov: number, height = PROJECTION.height): number {
  return height / 2 / Math.tan((fov * Math.PI) / 360);
}

/** A point `d` in front of the projection, on its normal. */
export function inFront(d: number): Vec3 {
  const [cx, cy, cz] = PROJECTION.center;
  const [nx, ny, nz] = PROJECTION.normal;
  return [cx + nx * d, cy + ny * d, cz + nz * d];
}

/**
 * What the zoom opens when no cartridge was chosen: the SO-101 in the spiral's lowest slot, the one
 * the machine plugs in on its own as the scroll passes (scene/robots.ts cartridgeAt(HELIX[0])).
 */
export const DEFAULT_CARTRIDGE: Cartridge = { id: "so101", label: "SO-101", route: "/pm/record", slot: 0, robot: "S101" };

/** A camera that holds one shot for the whole dwell. */
export const still =
  (pose: CameraPose) =>
  (): CameraPose =>
    pose;
