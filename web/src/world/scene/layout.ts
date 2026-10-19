// The workshop as Blender laid it out (docs/design/blender/export/layout.json, copied next to this
// file). Positions are already Y-up metres. Rotations are Blender Z-up quaternions (w, x, y, z): the
// glTF basis change (x, y, z) -> (x, z, -y) applies to their vector part too, so a slot's rotation is
// (x, z, -y, w) in three.js order. Everything here is converted once and pure, so it is tested.
import { camera_stations, helix, library, stations } from "./layout.json";
import type { CameraPose, Vec3 } from "../core/types";

export type Quat = readonly [number, number, number, number];

/** One cartridge place: on the spiral (with a label and a shell) or on a library shelf. */
export interface Slot {
  position: Vec3;
  /** three.js order (x, y, z, w), Y-up. */
  quaternion: Quat;
  scale: number;
}

export interface HelixSlot extends Slot {
  index: number;
  /** The robot code printed on the label, e.g. "S101". */
  code: string;
  /** Linear RGB shell tint; null is the default Graphite. */
  shell: readonly [number, number, number] | null;
}

/** Blender (w, x, y, z), Z-up -> three.js (x, y, z, w), Y-up. */
export function zupQuat([w, x, y, z]: readonly number[]): Quat {
  return [x, z, -y, w];
}

const vec3 = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];

export const HELIX: readonly HelixSlot[] = helix.map((s, index) => ({
  index,
  position: vec3(s.pos),
  quaternion: zupQuat(s.quat_zup),
  scale: s.scale,
  code: s.label,
  shell: s.shell ? [s.shell[0], s.shell[1], s.shell[2]] : null,
}));

export const LIBRARY: readonly Slot[] = library.map((s) => ({ position: vec3(s.pos), quaternion: zupQuat(s.quat_zup), scale: s.scale }));

/** A Blender pivot: where a model's origin sits and its turn about the vertical axis (radians). */
export interface Pivot {
  position: Vec3;
  yaw: number;
}

const pivot = (s: { pos: number[]; rot_z_deg: number }): Pivot => ({ position: vec3(s.pos), yaw: (s.rot_z_deg * Math.PI) / 180 });

/** machine.glb's origin. Its children already carry the 28° turn, so the group needs only this position. */
export const MACHINE_PIVOT = pivot(stations.machine);
/** workbench.glb's origin (same convention). */
export const BENCH_PIVOT = pivot(stations.workbench);

/** The journey's camera stops, by the name Blender gave each keyframe. */
export type StopName =
  | "Title"
  | "One demo → 100"
  | "Proof"
  | "Descent"
  | "Workshop intro"
  | "Tutorial 1 · shelf"
  | "Tutorial 2 · machine"
  | "Tutorial 3 · bench"
  | "Plug in"
  | "Projection"
  | "Zoom to UI"
  | "Workbench edit";

/**
 * Blender keys only eye and target. The lens isn't exported, so each stop gets the vertical fov that
 * frames it like the renders in docs/design/blender (matched by eye in the browser).
 */
const FOV: Partial<Record<StopName, number>> = {};
export const DEFAULT_FOV = 40;

/** A camera stop in world coordinates. Throws on a name the layout doesn't have. */
export function stop(name: StopName): CameraPose {
  const s = camera_stations.find((c) => c.name === name);
  if (!s) throw new Error(`world: layout.json has no camera stop "${name}"`);
  return { position: vec3(s.eye), target: vec3(s.target), fov: FOV[name] ?? DEFAULT_FOV };
}

/** A stop relative to a station's anchor (the rail adds the anchor back). */
export function stopFrom(anchor: Vec3, name: StopName): CameraPose {
  const p = stop(name);
  const sub = (v: Vec3): Vec3 => [v[0] - anchor[0], v[1] - anchor[1], v[2] - anchor[2]];
  return { position: sub(p.position), target: sub(p.target), fov: p.fov };
}
