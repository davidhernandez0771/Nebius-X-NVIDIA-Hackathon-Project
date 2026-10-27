// The cartridge bay on the machine's dock (plugSequence.ts BAY): a graphite sleeve whose opening is a
// cartridge's footprint plus a little clearance, black inside, on a flange over the dock's top, with a
// teal lip round its mouth that flashes as a cartridge seats (the machine's slot light). Built in the
// bay's own frame: x across the slot, z along it, y up from the dock's top. The shell carries per-vertex
// colour and metalness/roughness for the machine's one vertex-PBR material (materials.ts), the lip is
// its own geometry for the slot light's material. Pure, so it is tested.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BAY } from "./plugSequence";

const GRAPHITE = new THREE.Color("#2b3035");
const ALU = new THREE.Color("#8e979d");
const LINER = new THREE.Color("#040506");
/** Metalness, roughness. */
const SHELL_MR = [0.55, 0.42] as const;
const ALU_MR = [0.9, 0.3] as const;
const LINER_MR = [0, 0.95] as const;
const FLANGE = 0.07;
const FLANGE_H = 0.05;
const LIP_H = 0.035;
const LIP_W = 0.03;
const LINER_T = 0.006;

function box(w: number, h: number, d: number, at: [number, number, number], color: THREE.Color, mr: readonly [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(...at);
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  const m = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    c.set([color.r, color.g, color.b], i * 3);
    m.set(mr, i * 2);
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  g.setAttribute("aMR", new THREE.BufferAttribute(m, 2));
  g.deleteAttribute("uv");
  return g;
}

export function bayGeometry(): { shell: THREE.BufferGeometry; lip: THREE.BufferGeometry } {
  const { halfLong: L, halfShort: S, wall: W, height: H } = BAY;
  const parts = [
    // The flange on the dock's top.
    box(2 * (S + W + FLANGE), FLANGE_H, 2 * (L + W + FLANGE), [0, FLANGE_H / 2, 0], GRAPHITE, SHELL_MR),
    // The long walls (along the slot) and the short ends.
    box(W, H, 2 * (L + W), [S + W / 2, H / 2, 0], GRAPHITE, SHELL_MR),
    box(W, H, 2 * (L + W), [-(S + W / 2), H / 2, 0], GRAPHITE, SHELL_MR),
    box(2 * S, H, W, [0, H / 2, L + W / 2], GRAPHITE, SHELL_MR),
    box(2 * S, H, W, [0, H / 2, -(L + W / 2)], GRAPHITE, SHELL_MR),
    // A brushed aluminium band round the mouth, and another at the foot (as the dock's own trim).
    box(2 * (S + W) + 0.02, 0.07, 2 * (L + W) + 0.02, [0, H - 0.035, 0], ALU, ALU_MR),
    box(2 * (S + W) + 0.02, 0.04, 2 * (L + W) + 0.02, [0, FLANGE_H + 0.02, 0], ALU, ALU_MR),
    // Black inside: a liner on each inner face, and the floor.
    box(LINER_T, H - 0.01, 2 * L, [S - LINER_T / 2, H / 2, 0], LINER, LINER_MR),
    box(LINER_T, H - 0.01, 2 * L, [-(S - LINER_T / 2), H / 2, 0], LINER, LINER_MR),
    box(2 * S, H - 0.01, LINER_T, [0, H / 2, L - LINER_T / 2], LINER, LINER_MR),
    box(2 * S, H - 0.01, LINER_T, [0, H / 2, -(L - LINER_T / 2)], LINER, LINER_MR),
    box(2 * S, 0.01, 2 * L, [0, FLANGE_H + 0.005, 0], LINER, LINER_MR),
  ];
  const shell = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  // The lip: a thin frame round the mouth, on the walls' tops.
  const lips = [
    new THREE.BoxGeometry(LIP_W, LIP_H, 2 * (L + LIP_W)).translate(S + LIP_W / 2, H + LIP_H / 2, 0),
    new THREE.BoxGeometry(LIP_W, LIP_H, 2 * (L + LIP_W)).translate(-(S + LIP_W / 2), H + LIP_H / 2, 0),
    new THREE.BoxGeometry(2 * S, LIP_H, LIP_W).translate(0, H + LIP_H / 2, L + LIP_W / 2),
    new THREE.BoxGeometry(2 * S, LIP_H, LIP_W).translate(0, H + LIP_H / 2, -(L + LIP_W / 2)),
    // Two teal marks down each long side, like the dock's.
    ...[-1, 1].flatMap((side) => [-0.55, 0.55].map((z) => new THREE.BoxGeometry(0.012, H * 0.55, 0.05).translate(side * (S + W + 0.006), H * 0.45, z))),
  ].map((g) => g.toNonIndexed());
  const lip = mergeGeometries(lips)!;
  lips.forEach((g) => g.dispose());
  return { shell, lip };
}
