// What a carried cartridge can't pass through: the room's floor, walls and ceiling, the pedestal, the
// spiral, the bench, the machine's desk and the machine on it. Measured from the baked GLBs (their
// vertices turned into each station's frame: docs/superpowers/notes/2026-10-22-workshop-interact.md).
// The cartridge is a body `radius` wide and `half` high round its centre. A point inside a table or
// the machine lifts over it; against a wall or the spiral it slides along. Moves go in short steps, so
// nothing thin is jumped through. Pure, so it is tested.
import * as THREE from "three";
import { BENCH_PIVOT, MACHINE_PIVOT } from "./layout";

/** A box standing on the floor, turned about the vertical axis by `yaw` round its centre. */
export interface Block {
  name: string;
  center: readonly [number, number];
  half: readonly [number, number];
  yaw: number;
  bottom: number;
  top: number;
}

/** The room's floor (the pedestal stands proud of it), its ceiling, and the walls' insides (the robot wall's shelves on the sides). */
export const ROOM = { floor: -0.6, ceiling: 14.4, x: [-19.4, 19.4], z: [-20.2, 12.5] } as const;
export const PEDESTAL = { radius: 4.6, top: -0.22 } as const;
/** The spiral: a carried cartridge's centre stays this far from the axis (its cartridges stand 2.3–4.1 m out, facing out, 0.34 m deep). */
export const SPIRAL_R = 4.35;
/** With the spiral lifted out of the way (lift.ts), only the arm's mast and base stand in the middle. */
export const MAST_R = 1.6;

const turnedOffset = (yaw: number, x: number, z: number): [number, number] => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];

function block(name: string, pivot: { position: readonly number[]; yaw: number }, local: [number, number], half: [number, number], bottom: number, top: number): Block {
  const [ox, oz] = turnedOffset(pivot.yaw, local[0], local[1]);
  return { name, center: [pivot.position[0] + ox, pivot.position[2] + oz], half, yaw: pivot.yaw, bottom, top };
}

export const BLOCKS: readonly Block[] = [
  block("desk", MACHINE_PIVOT, [0, 0], [4.0, 2.1], ROOM.floor, 2.69),
  block("machine", MACHINE_PIVOT, [-0.13, -0.03], [4.15, 1.25], 2.69, 4.38),
  // The cartridge bay on the dock (plugSequence.ts BAY: the opening and its walls; its top 5.4 m).
  block("bay", MACHINE_PIVOT, [-3.7, 0.004], [0.3, 1.28], 4.35, 5.4),
  block("bench", BENCH_PIVOT, [0, 0], [4.62, 2.43], ROOM.floor, 2.75),
  // The label printer at the bench's back left corner.
  block("printer", BENCH_PIVOT, [-2.75, -1.55], [0.8, 0.65], 2.75, 3.21),
];

export interface Body {
  radius: number;
  half: number;
}

/** A spiral cartridge hanging upright (cartridge.glb: 2.3 m wide, 2.5 m tall) at `scale`. */
export const cartridgeBody = (scale = 1): Body => ({ radius: 1.15 * scale, half: 1.25 * scale });

/** Clearance kept over a top (metres). */
const CLEAR = 0.06;

/** In the block's own frame: x along its length, z across. */
function local(b: Block, p: THREE.Vector3): [number, number] {
  return turnedOffset(-b.yaw, p.x - b.center[0], p.z - b.center[1]);
}

/**
 * Where `p` goes so the body doesn't overlap anything, in place. Returns what it hit (names), if anything.
 * `spiralR`: how far from the axis it must stay (the spiral's ring, or only the mast once it has lifted).
 */
export function resolve(p: THREE.Vector3, body: Body, hits: string[] = [], spiralR = SPIRAL_R): string[] {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    // Walls and ceiling: slide along them.
    const x = THREE.MathUtils.clamp(p.x, ROOM.x[0] + body.radius, ROOM.x[1] - body.radius);
    const z = THREE.MathUtils.clamp(p.z, ROOM.z[0] + body.radius, ROOM.z[1] - body.radius);
    if (x !== p.x || z !== p.z) {
      p.x = x;
      p.z = z;
      hits.push("wall");
    }
    if (p.y > ROOM.ceiling - body.half) {
      p.y = ROOM.ceiling - body.half;
      hits.push("ceiling");
    }
    // The spiral: round it, never through it.
    const r = Math.hypot(p.x, p.z);
    if (r < spiralR) {
      const s = r > 1e-6 ? spiralR / r : 1;
      p.x = r > 1e-6 ? p.x * s : spiralR;
      p.z *= r > 1e-6 ? s : 0;
      hits.push("spiral");
      moved = true;
    }
    // The floor, and the pedestal standing on it.
    const floor = Math.hypot(p.x, p.z) < PEDESTAL.radius + body.radius ? PEDESTAL.top : ROOM.floor;
    if (p.y < floor + body.half + CLEAR) {
      p.y = floor + body.half + CLEAR;
      hits.push("floor");
    }
    // Tables and the machine: over them.
    for (const b of BLOCKS) {
      const [lx, lz] = local(b, p);
      const inX = Math.abs(lx) < b.half[0] + body.radius;
      const inZ = Math.abs(lz) < b.half[1] + body.radius;
      const inY = p.y - body.half < b.top + CLEAR && p.y + body.half > b.bottom;
      if (!(inX && inZ && inY)) continue;
      p.y = b.top + body.half + CLEAR;
      hits.push(b.name);
      moved = true;
    }
    if (!moved) break;
  }
  return hits;
}

/**
 * Move from `from` toward `to` in steps of at most `step` metres, each resolved, into `out`: a path
 * that rises over a table on the way rather than cutting through it, and comes back down beyond it.
 */
export function sweep(from: THREE.Vector3, to: THREE.Vector3, body: Body, out: THREE.Vector3, step = 0.25, spiralR = SPIRAL_R): THREE.Vector3 {
  const n = Math.max(1, Math.ceil(from.distanceTo(to) / step));
  out.copy(from);
  const d = new THREE.Vector3();
  for (let i = 1; i <= n; i++) {
    // Each step heads for the target from where the last one ended up (lifted, slid).
    d.copy(to).sub(out).divideScalar(n - i + 1);
    out.add(d);
    resolve(out, body, undefined, spiralR);
  }
  return out;
}

/** Whether the body at `p` overlaps nothing (to a millimetre). */
export function clear(p: THREE.Vector3, body: Body, spiralR = SPIRAL_R): boolean {
  const q = p.clone();
  resolve(q, body, undefined, spiralR);
  return q.distanceTo(p) < 1e-3;
}

/** Whether the body at `p` overlaps a table or the machine (the furniture alone: not the spiral, walls or floor). */
export function hitsFurniture(p: THREE.Vector3, body: Body): boolean {
  return BLOCKS.some((b) => {
    const [lx, lz] = local(b, p);
    return Math.abs(lx) < b.half[0] + body.radius && Math.abs(lz) < b.half[1] + body.radius && p.y - body.half < b.top + CLEAR && p.y + body.half > b.bottom;
  });
}
