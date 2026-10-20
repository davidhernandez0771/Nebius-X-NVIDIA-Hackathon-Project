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

/** An empty place on the spiral (a gap Blender left in the helix), where a saved cartridge goes. */
export interface SpareSlot extends Slot {
  /** Numbered on after the helix slots: HELIX.length + its place. */
  index: number;
  /** The helix slot it follows. */
  after: number;
}

const azimuth = (p: Vec3) => Math.atan2(p[2], p[0]);
const wrapPi = (a: number) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

/**
 * The helix's gaps, filled: where the turn from one slot to the next is a whole step or more wider
 * than usual, the missing places are spaced evenly between the two (angle, radius and height), each
 * turned about the axis from the slot before it, so it faces out like its neighbours.
 */
function spareSlots(helix: readonly HelixSlot[]): SpareSlot[] {
  const steps = helix.slice(1).map((s, i) => wrapPi(azimuth(s.position) - azimuth(helix[i].position)));
  const sorted = steps.map(Math.abs).sort((a, b) => a - b);
  const usual = sorted[Math.floor(sorted.length / 2)];
  const out: SpareSlot[] = [];
  steps.forEach((d, i) => {
    const missing = Math.round(Math.abs(d) / usual) - 1;
    const a = helix[i];
    const b = helix[i + 1];
    const a0 = azimuth(a.position);
    const r0 = Math.hypot(a.position[0], a.position[2]);
    const r1 = Math.hypot(b.position[0], b.position[2]);
    for (let k = 1; k <= missing; k++) {
      const f = k / (missing + 1);
      const ang = a0 + d * f;
      const r = r0 + (r1 - r0) * f;
      // A turn of phi about +Y moves a point's azimuth by -phi.
      const half = (-d * f) / 2;
      const s = Math.sin(half);
      const c = Math.cos(half);
      const [x, y, z, w] = a.quaternion;
      const q = [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y];
      const n = Math.hypot(...q);
      out.push({
        index: helix.length + out.length,
        after: i,
        position: [r * Math.cos(ang), a.position[1] + (b.position[1] - a.position[1]) * f, r * Math.sin(ang)],
        quaternion: [q[0] / n, q[1] / n, q[2] / n, q[3] / n],
        scale: a.scale + (b.scale - a.scale) * f,
      });
    }
  });
  return out;
}

export const SPARE: readonly SpareSlot[] = spareSlots(HELIX);

/** A spiral place by number: a helix slot, or one of the empty places after them. */
export function slotAt(index: number): Slot & { index: number } {
  const s = index < HELIX.length ? HELIX[index] : SPARE[index - HELIX.length];
  if (!s) throw new Error(`world: no slot ${index} on the spiral`);
  return s;
}

export const LIBRARY: readonly Slot[] =library.map((s) => ({ position: vec3(s.pos), quaternion: zupQuat(s.quat_zup), scale: s.scale }));

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
