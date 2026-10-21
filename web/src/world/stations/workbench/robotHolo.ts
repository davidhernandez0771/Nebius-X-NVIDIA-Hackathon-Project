// What the bench's robot hologram shows for each robot: its maker's model, the same GLB the robot wall
// stands (scene/robotModels.ts, loaded with the wall's own loader), or, for the Rizon 4, which has no
// model on the site, the wall's stand-in (wallParts.ts STAND_INS: it suggests the arm, it isn't its real
// geometry). Each is stood on its foot, centred, and scaled to the hologram's size. A model loads once
// and is kept (a promise per robot, retried after a failure); holoNow gives it at once when it is in.
import * as THREE from "three";
import { loadRobotModel, type ModelId } from "../../scene/robotModels";
import { STAND_INS, standIn } from "../../scene/wallParts";
import { HOLO_H } from "./layout";

export type HoloSource = { model: ModelId } | { standIn: keyof typeof STAND_INS };

export const HOLO_SOURCE: Readonly<Record<string, HoloSource>> = {
  S101: { model: "so101" },
  FR3: { model: "fr3" },
  PPR: { model: "piper" },
  RZ4: { standIn: "flexiv" },
  OPN: { model: "openarm" },
};

/** A copy of `src` standing at the origin on its foot (its lowest few centimetres), its largest side HOLO_H. */
export function holoGeometry(src: THREE.BufferGeometry, size = HOLO_H): THREE.BufferGeometry {
  const g = src.clone();
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const k = size / Math.max(b.max.y - b.min.y, b.max.x - b.min.x, b.max.z - b.min.z);
  // The foot's middle, not the box's: an arm reaching out to one side still stands on the ring.
  const pos = g.getAttribute("position");
  const low = b.min.y + (0.04 * size) / k;
  let fx = 0;
  let fz = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) <= low) {
      fx += pos.getX(i);
      fz += pos.getZ(i);
      n++;
    }
  g.translate(-fx / Math.max(1, n), -b.min.y, -fz / Math.max(1, n));
  g.scale(k, k, k);
  g.computeBoundingBox();
  return g;
}

const loading = new Map<string, Promise<THREE.BufferGeometry>>();
const ready = new Map<string, THREE.BufferGeometry>();

/** The hologram's geometry for a robot code, loading its model the first time (shared afterwards: clone it to change it). */
export function holoFor(code: string, load: (id: string) => Promise<THREE.BufferGeometry> = loadRobotModel): Promise<THREE.BufferGeometry> {
  const src = HOLO_SOURCE[code];
  if (!src) throw new Error(`world: no hologram for robot "${code}"`);
  const had = loading.get(code);
  if (had) return had;
  // The models reach along +x; the wall's stand-in reaches along z (in profile): turn it to match.
  const p = ("model" in src ? load(src.model) : Promise.resolve(standIn(src.standIn).rotateY(Math.PI / 2))).then(
    (raw) => {
      const g = holoGeometry(raw);
      raw.dispose();
      ready.set(code, g);
      return g;
    },
    (e) => {
      // Not kept: the next ask tries again.
      loading.delete(code);
      throw e;
    },
  );
  loading.set(code, p);
  return p;
}

/** The hologram's geometry if it is already in, else null. */
export const holoNow = (code: string): THREE.BufferGeometry | null => ready.get(code) ?? null;

/** Forget what was loaded (tests). */
export function resetHolos(): void {
  loading.clear();
  ready.forEach((g) => g.dispose());
  ready.clear();
}
