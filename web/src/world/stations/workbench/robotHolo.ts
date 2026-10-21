// What the bench's robot hologram shows for each robot: the twin's Franka (its URDF's collision meshes,
// as the robot wall stands it) or the robot wall's stand-in for the arms the site has no mesh for
// (wallParts.ts STAND_INS: they suggest each arm, they aren't its real geometry). Each is stood on its
// base, centred, and scaled to the hologram's height. When T5's robot models land
// (public/world/models/robots/), they replace the stand-ins here.
import * as THREE from "three";
import { STAND_INS, standIn } from "../../scene/wallParts";
import { HOLO_H } from "./layout";

export const HOLO_SOURCE: Readonly<Record<string, "franka" | keyof typeof STAND_INS>> = {
  S101: "so101",
  FR3: "franka",
  PPR: "piper",
  RZ4: "flexiv",
  OPN: "openarm",
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

/** The hologram's geometry for a robot code (null: the Franka, until its meshes are in). */
export function robotHoloGeometry(code: string, franka: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  const src = HOLO_SOURCE[code];
  if (!src) throw new Error(`world: no hologram for robot "${code}"`);
  if (src === "franka") return franka ? holoGeometry(franka) : null;
  const g = standIn(src);
  const out = holoGeometry(g);
  g.dispose();
  return out;
}
