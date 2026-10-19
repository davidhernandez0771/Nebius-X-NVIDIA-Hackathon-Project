// The spiral shelf itself: the dark band the cartridges stand on, winding up under every slot, with
// a teal light along its outer edge (as in the renders; Blender didn't export it, so it is built here
// from the slots). A smooth curve runs through the cartridges' bottom edges; the band is that curve
// widened toward and away from the axis.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { HELIX } from "./layout";
import { addGlow } from "./power";

/** Half a cartridge's height: a slot's position is the cartridge's centre. */
const HALF_H = 1.25;
const HALF_W = 0.62;
const EDGE_H = 0.05;
const SAMPLES = 480;
export const TEAL = "#3FE0C0";

/** The band's centre line, through each cartridge's bottom edge, a quarter turn past both ends. */
export function ribbonCurve(): THREE.CatmullRomCurve3 {
  const pts = HELIX.map((s) => new THREE.Vector3(s.position[0], s.position[1] - HALF_H * s.scale - 0.02, s.position[2]));
  const extend = (a: THREE.Vector3, b: THREE.Vector3) => {
    // Continue the turn past the end: rotate the last step on around the axis.
    const ang = Math.atan2(a.x, a.z) - Math.atan2(b.x, b.z);
    const r = Math.hypot(a.x, a.z);
    const t = Math.atan2(a.x, a.z) + ang;
    return new THREE.Vector3(r * Math.sin(t), a.y + (a.y - b.y), r * Math.cos(t));
  };
  pts.unshift(extend(pts[0], pts[1]));
  pts.push(extend(pts[pts.length - 1], pts[pts.length - 2]));
  return new THREE.CatmullRomCurve3(pts, false, "centripetal");
}

function bandGeometry(curve: THREE.CatmullRomCurve3): { band: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  const band: number[] = [];
  const edge: number[] = [];
  const p = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (let i = 0; i <= SAMPLES; i++) {
    curve.getPointAt(i / SAMPLES, p);
    out.set(p.x, 0, p.z).normalize();
    const ix = p.x - out.x * HALF_W;
    const iz = p.z - out.z * HALF_W;
    const ox = p.x + out.x * HALF_W;
    const oz = p.z + out.z * HALF_W;
    band.push(ix, p.y, iz, ox, p.y, oz);
    edge.push(ox, p.y - EDGE_H, oz, ox + out.x * 0.01, p.y + 0.005, oz + out.z * 0.01);
  }
  const strip = (pos: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return { band: strip(band), edge: strip(edge) };
}

export function Ribbon() {
  const { band, edge } = useMemo(() => bandGeometry(ribbonCurve()), []);
  // Matte on every tier: a glossy band catches the key light as a grey sheet.
  const bandMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#0b0d10", side: THREE.DoubleSide }), []);
  const edgeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: TEAL, toneMapped: false, side: THREE.DoubleSide }), []);
  useEffect(() => {
    const off = addGlow(edgeMat, TEAL);
    return () => {
      off();
      bandMat.dispose();
      edgeMat.dispose();
      band.dispose();
      edge.dispose();
    };
  }, [band, edge, bandMat, edgeMat]);
  return (
    <group name="ribbon">
      <mesh geometry={band} material={bandMat} raycast={() => null} />
      <mesh geometry={edge} material={edgeMat} raycast={() => null} />
    </group>
  );
}
