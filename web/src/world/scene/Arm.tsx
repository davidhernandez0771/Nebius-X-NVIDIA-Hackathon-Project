// The robot arm in the middle of the spiral (the prototype's twin, built from primitives). A mast
// rises from the pedestal to just under the cartridge it is looking at; on top, the arm turns toward
// the pointed-at cartridge (else the front one) and reaches out to it. Each moving segment is one
// merged mesh with vertex colours, plus one for its teal rings: 9 draw calls. Lit by the live lights,
// so it comes up with the lamps.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { QualityTier } from "../core/quality";
import { slotAt } from "./layout";
import { N_ITEMS, instanceSlot, spiral, stepPose } from "./spiral";

const PAINT = new THREE.Color("#d9d5cc");
const DARK = new THREE.Color("#15191b");
const GLOW = "#19f5c2";
/** The pedestal's top. */
const FLOOR_Y = -0.22;
/** Upper arm and forearm, metres; the reach stays inside the spiral (its cartridges stand at r ≈ 3). */
export const UPPER = 1.4;
export const FORE = 0.9;
const SHOULDER = 0.62;
const ELBOW = 1.22;
/** The arm's rise from shoulder to hand at that pose, so the hand meets the cartridge's height. */
export const RISE = UPPER * Math.cos(SHOULDER) + FORE * Math.cos(SHOULDER + ELBOW);
/** And its reach out from the axis. */
export const REACH = UPPER * Math.sin(SHOULDER) + FORE * Math.sin(SHOULDER + ELBOW);

type Piece = { geo: THREE.BufferGeometry; color: THREE.Color; at?: [number, number, number]; rot?: [number, number, number] };

function merge(pieces: Piece[]): THREE.BufferGeometry {
  const geos = pieces.map(({ geo, color, at, rot }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
    if (at) g.translate(...at);
    const n = g.getAttribute("position").count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const out = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return out;
}

const ring = (r: number, at: [number, number, number], rot: [number, number, number]): Piece => ({ geo: new THREE.TorusGeometry(r, 0.025, 6, 40), color: new THREE.Color(1, 1, 1), at, rot });

function build(tier: QualityTier) {
  const seg = tier.name === "low" ? 16 : 28;
  const mat = tier.name === "low" ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.25 });
  const glow = new THREE.MeshBasicMaterial({ color: GLOW, toneMapped: false });
  const joint = (r: number, y: number): Piece => ({ geo: new THREE.CylinderGeometry(r, r, r * 1.6, seg), color: DARK, at: [0, y, 0], rot: [0, 0, Math.PI / 2] });
  const link = (r: number, len: number, y0: number, color = PAINT): Piece => ({ geo: new THREE.CapsuleGeometry(r, len, 4, seg), color, at: [0, y0 + len / 2, 0] });

  const parts = {
    base: merge([{ geo: new THREE.CylinderGeometry(0.85, 1, 0.55, seg * 2), color: DARK, at: [0, 0.275, 0] }]),
    baseGlow: merge([ring(0.9, [0, 0.55, 0], [Math.PI / 2, 0, 0])]),
    // A unit-tall mast, scaled to the height it needs.
    mast: merge([{ geo: new THREE.CylinderGeometry(0.28, 0.34, 1, seg), color: PAINT, at: [0, 0.5, 0] }]),
    upper: merge([joint(0.38, 0), link(0.27, UPPER, 0.1)]),
    upperGlow: merge([ring(0.39, [0.3, 0, 0], [0, Math.PI / 2, 0])]),
    fore: merge([joint(0.3, 0), link(0.22, FORE, 0.08)]),
    foreGlow: merge([ring(0.31, [0.24, 0, 0], [0, Math.PI / 2, 0])]),
    hand: merge([
      joint(0.22, 0),
      { geo: new THREE.BoxGeometry(0.56, 0.18, 0.28), color: DARK, at: [0, 0.22, 0] },
      { geo: new THREE.BoxGeometry(0.07, 0.4, 0.18), color: PAINT, at: [-0.17, 0.5, 0] },
      { geo: new THREE.BoxGeometry(0.07, 0.4, 0.18), color: PAINT, at: [0.17, 0.5, 0] },
    ]),
    handGlow: merge([ring(0.23, [0.18, 0, 0], [0, Math.PI / 2, 0])]),
  };

  const root = new THREE.Group();
  root.name = "arm";
  root.position.y = FLOOR_Y;
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const x = new THREE.Mesh(g, m);
    x.name = `arm:${name}`;
    x.raycast = () => {};
    return x;
  };
  root.add(mesh(parts.base, mat, "base"), mesh(parts.baseGlow, glow, "baseGlow"));
  const mast = mesh(parts.mast, mat, "mast");
  mast.position.y = 0.55;
  root.add(mast);
  const yaw = new THREE.Group();
  root.add(yaw);
  const shoulder = new THREE.Group();
  yaw.add(shoulder);
  shoulder.add(mesh(parts.upper, mat, "upper"), mesh(parts.upperGlow, glow, "upperGlow"));
  const elbow = new THREE.Group();
  elbow.position.y = UPPER + 0.2;
  shoulder.add(elbow);
  elbow.add(mesh(parts.fore, mat, "fore"), mesh(parts.foreGlow, glow, "foreGlow"));
  const wrist = new THREE.Group();
  wrist.position.y = FORE + 0.16;
  elbow.add(wrist);
  wrist.add(mesh(parts.hand, mat, "hand"), mesh(parts.handGlow, glow, "handGlow"));
  const dispose = () => {
    Object.values(parts).forEach((g) => g.dispose());
    mat.dispose();
    glow.dispose();
  };
  return { root, mast, yaw, shoulder, elbow, wrist, dispose };
}

const _look = new THREE.Vector3();

/** Where the arm looks: the pointed-at cartridge, else the front one. */
function lookTarget(out: THREE.Vector3): THREE.Vector3 {
  const k = spiral.hover;
  if (k >= N_ITEMS) return out.set(...slotAt(instanceSlot(k)).position);
  if (k >= 0) return stepPose(spiral.pos[k], out).position;
  return stepPose(spiral.step, out).position;
}

export function Arm({ quality, reduced }: { quality: QualityTier; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const arm = useMemo(() => build(quality), [quality]);
  const st = useRef({ yaw: 0, top: 6 });
  useEffect(() => () => arm.dispose(), [arm]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const s = st.current;
    lookTarget(_look);
    // Yaw: the arm's local +z is its reach (the shoulder pitches forward about x).
    const want = Math.atan2(_look.x, _look.z);
    let dy = want - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = reduced ? 1 : 1 - Math.exp(-dt * 2.6);
    s.yaw += dy * k;
    const topWant = Math.min(12.6, Math.max(1.2, _look.y - FLOOR_Y - RISE - 0.55));
    const dTop = topWant - s.top;
    s.top += dTop * k;
    arm.mast.scale.y = s.top;
    arm.yaw.position.y = 0.55 + s.top;
    arm.yaw.rotation.y = s.yaw;
    const breathe = quality.idleMotion && !reduced ? Math.sin(clock.elapsedTime * 0.9) * 0.03 : 0;
    arm.shoulder.rotation.x = SHOULDER + breathe;
    arm.elbow.rotation.x = ELBOW - breathe * 1.4;
    arm.wrist.rotation.x = Math.PI / 2 - SHOULDER - ELBOW + 0.15;
    if (Math.abs(dy) > 0.001 || Math.abs(dTop) > 0.005) invalidate();
  });

  return <primitive object={arm.root} />;
}
