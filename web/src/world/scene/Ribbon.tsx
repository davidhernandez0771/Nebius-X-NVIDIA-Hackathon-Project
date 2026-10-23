// The spiral shelf itself: the dark band the cartridges stand on, winding up under every slot, with
// a teal light along its outer edge (as in the renders; Blender didn't export it, so it is built here
// from the slots). A smooth curve runs through the cartridges' bottom edges; the band is that curve
// widened toward and away from the axis. The light is a soft-edged line (materials.ts softLine): from
// the room view it is about two pixels tall, and drawn as hard geometry it crawled with the mouse look.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HELIX } from "./layout";
import { withSoftEdge } from "./materials";
import { liftOffset } from "./lift";
import { addGlow } from "./power";

/** Half a cartridge's height: a slot's position is the cartridge's centre. */
const HALF_H = 1.25;
const HALF_W = 0.62;
const EDGE_H = 0.05;
/** The edge strip reaches this many of the lip's half heights either side of its centre (softLine's room). */
export const EDGE_REACH = 3;
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

export function bandGeometry(curve: THREE.CatmullRomCurve3): { band: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  const band: number[] = [];
  const edge: number[] = [];
  const across: number[] = [];
  const p = new THREE.Vector3();
  const out = new THREE.Vector3();
  const lo = new THREE.Vector3();
  const hi = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (let i = 0; i <= SAMPLES; i++) {
    curve.getPointAt(i / SAMPLES, p);
    out.set(p.x, 0, p.z).normalize();
    const ix = p.x - out.x * HALF_W;
    const iz = p.z - out.z * HALF_W;
    const ox = p.x + out.x * HALF_W;
    const oz = p.z + out.z * HALF_W;
    band.push(ix, p.y, iz, ox, p.y, oz);
    // The lip: from under the band's outer edge up to just over it, leaning out 1 cm; the strip
    // reaches EDGE_REACH times as far either side of its centre, aAcross ±1 marking the lip.
    lo.set(ox, p.y - EDGE_H, oz);
    hi.set(ox + out.x * 0.01, p.y + 0.005, oz + out.z * 0.01);
    mid.addVectors(lo, hi).multiplyScalar(0.5);
    lo.sub(mid).multiplyScalar(EDGE_REACH).add(mid);
    hi.sub(mid).multiplyScalar(EDGE_REACH).add(mid);
    edge.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
    across.push(-EDGE_REACH, EDGE_REACH);
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
  const e = strip(edge);
  e.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  return { band: strip(band), edge: e };
}

export function Ribbon() {
  const { band, edge } = useMemo(() => bandGeometry(ribbonCurve()), []);
  // Matte on every tier: a glossy band catches the key light as a grey sheet.
  const bandMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#0b0d10", side: THREE.DoubleSide }), []);
  const edgeMat = useMemo(() => withSoftEdge(new THREE.MeshBasicMaterial({ color: TEAL, toneMapped: false, side: THREE.DoubleSide })), []);
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
  // It rises with the cartridges when the spiral lifts out of the arm's way (lift.ts; Helix asks for the frames).
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.position.y = liftOffset();
  });
  return (
    <group ref={group} name="ribbon">
      <mesh geometry={band} material={bandMat} raycast={() => null} />
      <mesh geometry={edge} material={edgeMat} raycast={() => null} />
    </group>
  );
}
