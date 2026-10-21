// The machine, v2: a realistic GPU-style card from docs/design/blender/machine-v2.blend (exported to
// web/public/world/models/machine_v2.glb). One mesh, nine plain materials, already in the machine's
// frame (the 28° turn baked in, like machine.glb's nodes): a faceted shroud with two fans, the fin
// stack, copper heat pipes, the backplate, the PCB with its gold edge, two power sockets, the cartridge
// dock with its slot on top and the projector's lens barrel.
//
// It is drawn live (not baked): its metals (graphite, aluminium, copper, gold, the fins) need the
// reflections that move with the camera, which a baked atlas can't hold, and the machine view comes
// close. To keep the draw calls of the old machine, the split is:
// - the body: every non-glowing material in ONE mesh, its colour, metalness and roughness per vertex;
// - the glow (the teal strip and the dock's marks), the slot (it flashes as a cartridge seats) and the
//   lens (it lights with the projection), each one mesh of its own;
// - each fan's blades and hub as one mesh and its teal mark as another, under a group on its axis, so
//   the fan turns. The blades are found in the single mesh: the pieces of the shroud's, the hub's and
//   the mark's materials that lie wholly inside a fan's opening, around the axis its teal mark marks.
//
// The old card is in the room's baked machine body too: cutBakedBody keeps only its power cable and
// plug (they fit the new card's sockets), so the old shroud, fins and port don't show through.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MACHINE_ANCHOR } from "../core/layout";
import { connectedPieces, subGeometry, type Piece } from "./meshPieces";

/** A fan's opening, from its axis: every piece of a fan lies inside it. */
const FAN_R = 1.0;
/** …and between its hub mark and this far below it (the blades reach 0.23 m down; their tips 0.96 m out). */
const FAN_DEPTH = 0.35;
/** The hologram stands this far above the lens's top (3.79 m in the machine's frame, as it stood). */
export const HOLO_ABOVE_LENS = 0.07;

export interface MachineV2 {
  /** position, normal, color, aMR (metalness, roughness) */
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  slot: THREE.BufferGeometry;
  lens: THREE.BufferGeometry;
  /** Each fan's parts, local to its axis (x, z at `centre`). */
  fans: { centre: THREE.Vector3; body: THREE.BufferGeometry; mark: THREE.BufferGeometry }[];
  /** The slot's top, and the lens's top centre, in the machine's frame. */
  slotTop: number;
  lensTop: THREE.Vector3;
  /** The glowing materials' emissive colours. */
  glowColor: THREE.Color;
  lensColor: THREE.Color;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  pieces: Piece[];
}

const isGlow = (m: THREE.MeshStandardMaterial) => !!m.emissive && m.emissive.getHex() !== 0;

/** Vertices of a piece, to test where it lies. */
function* vertsOf(g: THREE.BufferGeometry, p: Piece): Generator<THREE.Vector3> {
  const idx = g.index!.array as ArrayLike<number>;
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (const t of p.tris) for (let k = 0; k < 3; k++) yield v.fromBufferAttribute(pos as never, idx[t + k]);
}

/** Some of a part's pieces as a geometry, with its material's colour and metalness/roughness per vertex. */
function painted(part: Part, pieces: Piece[]): THREE.BufferGeometry {
  const g = subGeometry(part.geometry, pieces.flatMap((p) => p.tris), ["position", "normal"]);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  const mr = new Float32Array(n * 2);
  const c = part.material.color;
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    mr.set([part.material.metalness, part.material.roughness], i * 2);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aMR", new THREE.BufferAttribute(mr, 2));
  return g;
}

function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(geos);
  if (!g) throw new Error("world: machine_v2's pieces don't merge");
  geos.forEach((x) => x.dispose());
  return g;
}

/** machine_v2.glb's scene, split for drawing (see the top of this file). */
export function splitMachineV2(scene: THREE.Object3D): MachineV2 {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", mesh.geometry.getAttribute("position").clone());
    geometry.setAttribute("normal", mesh.geometry.getAttribute("normal").clone());
    const n = geometry.getAttribute("position").count;
    geometry.setIndex(mesh.geometry.index ? mesh.geometry.index.clone() : [...Array(n).keys()]);
    geometry.applyMatrix4(mesh.matrixWorld);
    parts.push({ geometry, material: mesh.material as THREE.MeshStandardMaterial, pieces: connectedPieces(geometry) });
  });
  const teal = parts.find((p) => /teal/i.test(p.material.name));
  const glass = parts.find((p) => /glass/i.test(p.material.name));
  if (!teal || !glass) throw new Error("world: machine_v2 has no teal or no glass material");

  // The fans' axes: the teal hub marks, flat round pieces about 0.28 m across.
  const marks = teal.pieces.filter((p) => {
    const s = p.box.getSize(new THREE.Vector3());
    return p.tris.length >= 100 && s.x < 0.4 && s.z < 0.4 && Math.abs(s.x - s.z) < 0.05;
  });
  const centres = marks.map((p) => new THREE.Vector3(p.centre.x, 0, p.centre.z)).sort((a, b) => a.x - b.x);
  const markY = Math.min(...marks.map((p) => p.centre.y));
  const fanOf = (part: Part, p: Piece): number => {
    // Below the fan (the backplate's vents under its opening) is not the fan.
    if (p.box.min.y < markY - FAN_DEPTH) return -1;
    for (let k = 0; k < centres.length; k++) {
      let inside = true;
      for (const v of vertsOf(part.geometry, p))
        if (Math.hypot(v.x - centres[k].x, v.z - centres[k].z) >= FAN_R) {
          inside = false;
          break;
        }
      if (inside) return k;
    }
    return -1;
  };

  const body: THREE.BufferGeometry[] = [];
  const fanBody: THREE.BufferGeometry[][] = centres.map(() => []);
  const fanMark: Piece[][] = centres.map(() => []);
  let slotPiece: Piece | null = null;
  for (const part of parts) {
    if (part === glass) continue;
    const byFan: Piece[][] = centres.map(() => []);
    const rest: Piece[] = [];
    for (const p of part.pieces) {
      const k = fanOf(part, p);
      if (k >= 0) byFan[k].push(p);
      else rest.push(p);
    }
    if (part === teal) {
      byFan.forEach((list, k) => fanMark[k].push(...list));
      // The slot's light: the highest teal piece (the dock's top).
      slotPiece = rest.reduce<Piece | null>((a, p) => (!a || p.centre.y > a.centre.y ? p : a), null);
      continue;
    }
    if (isGlow(part.material)) throw new Error(`world: machine_v2 glows in an unexpected material, ${part.material.name}`);
    if (rest.length) body.push(painted(part, rest));
    byFan.forEach((list, k) => list.length && fanBody[k].push(painted(part, list)));
  }
  if (!slotPiece) throw new Error("world: machine_v2 has no slot light");
  const slot = slotPiece as Piece;
  const glowPieces = teal.pieces.filter((p) => p !== slot && !fanMark.some((l) => l.includes(p)));

  const fans = centres.map((centre, k) => {
    const g = merged(fanBody[k]).translate(-centre.x, 0, -centre.z);
    const mark = subGeometry(teal.geometry, fanMark[k].flatMap((p) => p.tris), ["position", "normal"]).translate(-centre.x, 0, -centre.z);
    return { centre, body: g, mark };
  });
  const lens = subGeometry(glass.geometry, glass.pieces.flatMap((p) => p.tris), ["position", "normal"]);
  lens.computeBoundingBox();
  const lb = lens.boundingBox!;
  return {
    body: merged(body),
    glow: subGeometry(teal.geometry, glowPieces.flatMap((p) => p.tris), ["position", "normal"]),
    slot: subGeometry(teal.geometry, slot.tris, ["position", "normal"]),
    lens,
    fans,
    slotTop: slot.box.max.y,
    lensTop: new THREE.Vector3((lb.min.x + lb.max.x) / 2, lb.max.y, (lb.min.z + lb.max.z) / 2),
    glowColor: teal.material.emissive.clone(),
    lensColor: glass.material.emissive.clone(),
  };
}

/**
 * What stays of the baked machine body (machine_body.glb) under the new card, in the machine's frame:
 * machine.glb's M_Cable and M_PowerPlug, which fit the new card's power sockets (tested against the file).
 */
export const BAKED_BODY_KEEP: Record<"Cable" | "PowerPlug", THREE.Box3> = {
  Cable: new THREE.Box3(new THREE.Vector3(0.206, 0.022, -4.218), new THREE.Vector3(1.486, 5.023, -1.286)),
  PowerPlug: new THREE.Box3(new THREE.Vector3(0.132, 4.44, -1.582), new THREE.Vector3(0.742, 4.68, -1.034)),
};

/** The baked body (in the room's frame) with only the pieces whose centre is in a BAKED_BODY_KEEP box. */
export function cutBakedBody(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const anchor = new THREE.Vector3(...MACHINE_ANCHOR);
  const local = new THREE.Vector3();
  const keep = connectedPieces(g).filter((p) => {
    local.copy(p.centre).sub(anchor);
    return Object.values(BAKED_BODY_KEEP).some((b) => b.containsPoint(local));
  });
  const out = subGeometry(g, keep.flatMap((p) => p.tris));
  out.computeBoundingSphere();
  return out;
}
