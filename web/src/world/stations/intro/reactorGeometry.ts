// The reactor's detail, pure three.js (no renderer) so its cost per tier is tested: the rings with their bolts (in
// the ring's own mesh, so they spin with it), the panels cladding the core (two tiers, a window band between, the
// vents drawn by the shader), the junction boxes on the wall where the cables gather, and the clamps holding the
// cables along their sag (instanced). Reactor.tsx gives each its material.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TierName } from "../../core/quality";
import { CAVERN, CORE } from "./layout";
import { CABLES, clampsOf, CORE_PANELS, JUNCTIONS, RING_BOLTS } from "./reactorPlan";

const [AX, AZ] = CAVERN.axis;

export const REACTOR_TIERS: Record<TierName, { radial: number; ringSegments: number; maxTriangles: number }> = {
  low: { radial: 8, ringSegments: 96, maxTriangles: 30_000 },
  high: { radial: 12, ringSegments: 160, maxTriangles: 70_000 },
  ultra: { radial: 16, ringSegments: 220, maxTriangles: 110_000 },
};

/** Drop every attribute but position, normal and uv, non-indexed, so geometries of any origin merge. */
function plain(g: THREE.BufferGeometry, uvY?: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!["position", "normal", "uv"].includes(k)) out.deleteAttribute(k);
  if (uvY !== undefined) {
    const uv = out.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uvY);
  }
  if (out !== g) g.dispose();
  return out;
}

/** A ring of radius 1 in the xy plane (as TorusGeometry), with RING_BOLTS bolt heads round its outer edge and a thin
 *  flange inside (uv.y 3). The bolts' uv.y is -1 (the shader draws them as steel), their uv.x the bolt's place round. */
export function ringGeometry(radial: number, segments: number): THREE.BufferGeometry {
  const parts = [plain(new THREE.TorusGeometry(1, 0.05, radial, segments))];
  const flange = plain(new THREE.TorusGeometry(0.93, 0.012, 4, segments), 3);
  parts.push(flange);
  for (let k = 0; k < RING_BOLTS; k++) {
    const a = (k / RING_BOLTS) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.018, 0.018, 0.025, 6).rotateZ(Math.PI / 2).rotateZ(a).translate(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
    const b = plain(bolt, -1);
    const uv = b.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, k / RING_BOLTS);
    parts.push(b);
  }
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** The core's cladding: CORE_PANELS curved panels round it in two tiers with a window band between. uv.x runs
 *  across a panel, uv.y up it (the shader's vents and bolts). */
export function panelGeometry(segments: number): THREE.BufferGeometry {
  const r = CORE.radius + 0.42;
  const slot = (Math.PI * 2) / CORE_PANELS;
  const h = CORE.top - CORE.bottom;
  const tiers: [number, number][] = [[CORE.bottom + 1.2, CORE.bottom + h * 0.42], [CORE.bottom + h * 0.58, CORE.top - 1.4]];
  const parts: THREE.BufferGeometry[] = [];
  for (const [y0, y1] of tiers)
    for (let k = 0; k < CORE_PANELS; k++) {
      // Each panel takes 78% of its slot: the gaps show the glass and the light behind.
      const start = k * slot + slot * 0.11;
      const g = new THREE.CylinderGeometry(r, r, y1 - y0, Math.max(2, Math.round(segments / CORE_PANELS)), 1, true, start, slot * 0.78);
      parts.push(plain(g.translate(AX, (y0 + y1) / 2, AZ)));
    }
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.userData.panels = parts.length;
  return g;
}

/** A junction box at each JUNCTION: a steel box against the wall with a lid, four bolts and the conduit stubs its
 *  cables leave from; a lamp patch (uv.y 2, uv.x the box's index) the shader lights with its cables. */
export function junctionGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  JUNCTIONS.forEach((j, idx) => {
    const face = new THREE.Matrix4().makeRotationY(j.angle + Math.PI).setPosition(...j.pos);
    const add = (g: THREE.BufferGeometry, uvY?: number) => parts.push(plain(g.applyMatrix4(face), uvY));
    add(new THREE.BoxGeometry(1.5, 1.9, 0.55).translate(0, 0, -0.1));
    add(new THREE.BoxGeometry(1.62, 0.12, 0.62).translate(0, 0.98, -0.1));
    for (const [x, y] of [[-0.62, 0.8], [0.62, 0.8], [-0.62, -0.8], [0.62, -0.8]])
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6).rotateX(Math.PI / 2).translate(x, y, 0.2));
    for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 8).rotateX(Math.PI / 2).translate((k - 1.5) * 0.22, -0.55, 0.3));
    const lamp = plain(new THREE.PlaneGeometry(0.9, 0.08).translate(0, 0.55, 0.181).applyMatrix4(face), 2);
    const uv = lamp.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, idx);
    parts.push(lamp);
  });
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.userData.boxes = JUNCTIONS.length;
  return g;
}

/** One clamp: a collar round the cable (axis y) and a small bracket plate under it. */
export function clampGeometry(radial: number): THREE.BufferGeometry {
  const collar = plain(new THREE.CylinderGeometry(0.2, 0.2, 0.16, radial, 1, true));
  const lip = plain(new THREE.TorusGeometry(0.2, 0.025, 4, radial).rotateX(Math.PI / 2).translate(0, 0.08, 0));
  const plate = plain(new THREE.BoxGeometry(0.1, 0.12, 0.5).translate(0.22, 0, 0));
  const g = mergeGeometries([collar, lip, plate], false)!;
  [collar, lip, plate].forEach((p) => p.dispose());
  return g;
}

/** Each clamp's matrix: at its point on its cable, its axis (y) along the cable. */
export function clampMatrices(): THREE.Matrix4[] {
  const y = new THREE.Vector3(0, 1, 0);
  const out: THREE.Matrix4[] = [];
  for (const c of CABLES)
    for (const k of clampsOf(c)) {
      const q = new THREE.Quaternion().setFromUnitVectors(y, new THREE.Vector3(...k.dir));
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(...k.pos), q, new THREE.Vector3(1, 1, 1)));
    }
  return out;
}

export interface ReactorPiece {
  name: string;
  geometry: THREE.BufferGeometry;
  instances?: number;
  matrices?: THREE.Matrix4[];
}

/** The detail pieces for a tier (the rings are instanced by Reactor.tsx, one per RINGS entry). */
export function buildReactorDetail(tier: TierName): ReactorPiece[] {
  const T = REACTOR_TIERS[tier];
  const clamps = clampMatrices();
  return [
    { name: "rings", geometry: ringGeometry(T.radial, T.ringSegments), instances: 4 },
    { name: "panels", geometry: panelGeometry(T.radial * 6) },
    { name: "junctions", geometry: junctionGeometry() },
    { name: "clamps", geometry: clampGeometry(T.radial), instances: clamps.length, matrices: clamps },
  ];
}
