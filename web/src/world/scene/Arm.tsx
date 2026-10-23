// The robot arm in the middle of the spiral: an industrial arm on a mast that rises from the pedestal
// (armIk.ts has its sizes and its joints). On its own it looks about: it turns to the pointed-at
// cartridge (else the front one) and holds its hand up inside the spiral behind it. When a cartridge
// is dragged, the drag steers it (armTask.ts): its fingertips go exactly where they are told, so it
// takes the cartridge out of its slot, carries it, puts it back or lowers it into the machine's port.
// It also follows a dropped cartridge's insert on the machine (plugSequence.ts, held) and lets go at
// the click. While it carries one, the whole spiral is lifted up out of its way (lift.ts).
// Each moving segment is one merged mesh: per-vertex colour, metalness/roughness and glow, so painted
// shells, dark joints, steel and the teal rings share one draw call per segment (10). Lit by the live
// lights; the rings follow the lamps.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { QualityTier } from "../core/quality";
import { ARM, GRIP_DEPTH, HANG, SHOULDER_MAX, armPoints, armPose, solveArm, wristAbove, type ArmPose } from "./armIk";
import { armTask } from "./armTask";
import { slotAt } from "./layout";
import { plug } from "./plug";
import { liftAt, PHASE, cartridgePose } from "./plugSequence";
import { spiralLift, stepLift } from "./lift";
import { power } from "./power";
import { N_ITEMS, instanceSlot, spiral, stepPose } from "./spiral";

const PAINT = new THREE.Color("#dedbd3");
const DARK = new THREE.Color("#16191c");
const STEEL = new THREE.Color("#9aa3a8");
const RUBBER = new THREE.Color("#0b0d0e");
const TEAL = new THREE.Color("#19f5c2");

/** Metalness, roughness and glow of each finish. */
const FINISH = {
  paint: [0.05, 0.42, 0],
  dark: [0.35, 0.55, 0],
  steel: [0.9, 0.28, 0],
  rubber: [0, 0.85, 0],
  glow: [0, 1, 1],
} as const;
type Finish = keyof typeof FINISH;

/** How far in from the spiral's cartridges the idle hand waits (its wrist, from the axis). */
export const IDLE_R = 1.55;
/** The fingers' half gap, open and closed on a cartridge (0.34 m thick). */
const FINGER_OPEN = 0.34;
const FINGER_SHUT = 0.19;

type Piece = { geo: THREE.BufferGeometry; color: THREE.Color; finish: Finish; at?: [number, number, number]; rot?: [number, number, number] };

function merge(pieces: Piece[]): THREE.BufferGeometry {
  const geos = pieces.map(({ geo, color, finish, at, rot }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
    if (at) g.translate(...at);
    const n = g.getAttribute("position").count;
    const c = new Float32Array(n * 3);
    const mr = new Float32Array(n * 3);
    const f = FINISH[finish];
    for (let i = 0; i < n; i++) {
      c.set([color.r, color.g, color.b], i * 3);
      mr.set(f, i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.setAttribute("aMRG", new THREE.BufferAttribute(mr, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const out = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return out;
}

/** One material for a segment: colour, metalness, roughness and glow per vertex; `uGlow` scales the rings. */
function armMaterial(tier: QualityTier) {
  const glow = { value: 1 };
  const m = tier.name === "low" ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = glow;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aMRG;\nvarying vec3 vMRG;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vMRG = aMRG;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMRG;\nuniform float uGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * vMRG.z * uGlow * 2.2;");
    if (tier.name !== "low")
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <metalnessmap_fragment>", "float metalnessFactor = metalness * vMRG.x;")
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * vMRG.y;");
  };
  m.customProgramCacheKey = () => `arm-${tier.name}`;
  return { material: m, glow };
}

function build(tier: QualityTier) {
  const seg = tier.name === "low" ? 14 : 28;
  const cyl = (r: number, h: number, color: THREE.Color, finish: Finish, at: [number, number, number] = [0, 0, 0], rot?: [number, number, number], r2 = r): Piece => ({ geo: new THREE.CylinderGeometry(r, r2, h, seg), color, finish, at, rot });
  const box = (w: number, h: number, d: number, color: THREE.Color, finish: Finish, at: [number, number, number]): Piece => ({ geo: new THREE.BoxGeometry(w, h, d), color, finish, at });
  const ring = (r: number, at: [number, number, number], rot: [number, number, number], t = 0.022): Piece => ({ geo: new THREE.TorusGeometry(r, t, 6, 48), color: TEAL, finish: "glow", at, rot });
  /** A joint across the arm (its axis along x): a dark drum with steel caps and a teal ring each side. */
  const joint = (r: number, w: number): Piece[] => [
    cyl(r, w, DARK, "dark", [0, 0, 0], [0, 0, Math.PI / 2]),
    cyl(r * 0.62, w + 0.06, STEEL, "steel", [0, 0, 0], [0, 0, Math.PI / 2]),
    ring(r * 1.01, [w * 0.32, 0, 0], [0, Math.PI / 2, 0]),
    ring(r * 1.01, [-w * 0.32, 0, 0], [0, Math.PI / 2, 0]),
  ];
  /** A painted link along +y from y0, with a dark band near each end. */
  const link = (r: number, len: number, y0: number): Piece[] => [
    { geo: new THREE.CapsuleGeometry(r, len, 6, seg), color: PAINT, finish: "paint", at: [0, y0 + len / 2, 0] },
    cyl(r * 1.04, 0.08, DARK, "dark", [0, y0 + 0.25, 0]),
    cyl(r * 1.04, 0.08, DARK, "dark", [0, y0 + len - 0.25, 0]),
  ];
  /** A cable run down the side of a link (a dark tube with steel clips). */
  const cable = (len: number, y0: number, off: number): Piece[] => [
    cyl(0.045, len, RUBBER, "rubber", [off, y0 + len / 2, -0.05]),
    ...[0.2, 0.5, 0.8].map((f) => cyl(0.07, 0.05, STEEL, "steel", [off, y0 + len * f, -0.05])),
  ];

  const parts = {
    base: merge([
      cyl(0.95, 0.16, DARK, "dark", [0, 0.08, 0], undefined, 1.05),
      cyl(0.78, 0.42, PAINT, "paint", [0, 0.37, 0], undefined, 0.86),
      cyl(0.5, 0.08, STEEL, "steel", [0, 0.6, 0]),
      ring(0.97, [0, 0.17, 0], [Math.PI / 2, 0, 0], 0.03),
      ...Array.from({ length: 8 }, (_, i): Piece => {
        const a = (i / 8) * Math.PI * 2;
        return cyl(0.05, 0.05, STEEL, "steel", [Math.sin(a) * 0.88, 0.18, Math.cos(a) * 0.88]);
      }),
    ]),
    // A unit-tall mast (scaled to the height it needs): a steel column with its cable alongside.
    mast: merge([cyl(0.26, 1, STEEL, "steel", [0, 0.5, 0], undefined, 0.3), cyl(0.06, 1, RUBBER, "rubber", [0.3, 0.5, 0])]),
    // On top of the mast: the turret the arm turns on.
    head: merge([
      cyl(0.5, 0.5, PAINT, "paint", [0, -0.3, 0], undefined, 0.42),
      cyl(0.52, 0.08, DARK, "dark", [0, -0.56, 0]),
      ring(0.52, [0, -0.04, 0], [Math.PI / 2, 0, 0]),
      box(0.5, 0.42, 0.5, DARK, "dark", [0, -0.24, -0.48]),
    ]),
    upper: merge([...joint(0.42, 0.95), ...link(0.3, ARM.upper - 0.3, 0.15), ...cable(ARM.upper - 0.6, 0.3, 0.31)]),
    fore: merge([
      ...joint(0.33, 0.78),
      ...link(0.25, ARM.fore * 0.78, 0.1),
      // The sleeve's collar where it slides out.
      cyl(0.27, 0.14, DARK, "dark", [0, ARM.fore * 0.86, 0]),
      ring(0.275, [0, ARM.fore * 0.86 + 0.08, 0], [Math.PI / 2, 0, 0]),
    ]),
    // The telescoping sleeve, unit tall (scaled to how far it is out), steel.
    sleeve: merge([cyl(0.16, 1, STEEL, "steel", [0, 0.5, 0])]),
    hand: merge([
      ...joint(0.24, 0.5),
      cyl(0.2, 0.22, DARK, "dark", [0, 0.2, 0]),
      ring(0.21, [0, 0.31, 0], [Math.PI / 2, 0, 0]),
      // The palm: across the fingers' travel.
      box(0.92, 0.12, 0.34, PAINT, "paint", [0, 0.38, 0]),
      box(0.96, 0.03, 0.36, DARK, "dark", [0, 0.44, 0]),
    ]),
    finger: merge([box(0.07, 0.22, 0.26, DARK, "dark", [0, 0.55, 0]), box(0.05, 0.08, 0.28, RUBBER, "rubber", [0, ARM.hand - 0.04, 0])]),
  };

  const { material, glow } = armMaterial(tier);
  const hand = armMaterial(tier);

  const root = new THREE.Group();
  root.name = "arm";
  root.position.y = ARM.floor;
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const x = new THREE.Mesh(g, m);
    x.name = `arm:${name}`;
    x.raycast = () => {};
    return x;
  };
  root.add(mesh(parts.base, material, "base"));
  const mast = mesh(parts.mast, material, "mast");
  mast.position.y = ARM.foot;
  root.add(mast);
  const yaw = new THREE.Group();
  root.add(yaw);
  yaw.add(mesh(parts.head, material, "head"));
  const shoulder = new THREE.Group();
  yaw.add(shoulder);
  shoulder.add(mesh(parts.upper, material, "upper"));
  const elbow = new THREE.Group();
  elbow.position.y = ARM.upper;
  shoulder.add(elbow);
  elbow.add(mesh(parts.fore, material, "fore"));
  const sleeve = mesh(parts.sleeve, material, "sleeve");
  sleeve.position.y = ARM.fore * 0.8;
  elbow.add(sleeve);
  const wrist = new THREE.Group();
  elbow.add(wrist);
  const roll = new THREE.Group();
  wrist.add(roll);
  roll.add(mesh(parts.hand, hand.material, "hand"));
  const fingerA = mesh(parts.finger, hand.material, "fingerA");
  const fingerB = mesh(parts.finger, hand.material, "fingerB");
  roll.add(fingerA, fingerB);
  const dispose = () => {
    Object.values(parts).forEach((g) => g.dispose());
    material.dispose();
    hand.material.dispose();
  };
  return { root, mast, yaw, shoulder, elbow, sleeve, wrist, roll, fingerA, fingerB, glow, handGlow: hand.glow, dispose };
}

const _look = new THREE.Vector3();

/** Where the arm looks on its own: the pointed-at cartridge, else the front one. */
function lookTarget(out: THREE.Vector3): THREE.Vector3 {
  const k = spiral.hover;
  if (k >= N_ITEMS) return out.set(...slotAt(instanceSlot(k)).position);
  if (k >= 0) return stepPose(spiral.pos[k], out).position;
  return stepPose(spiral.step, out).position;
}

/**
 * The idle wrist: inside the spiral behind the cartridge at `c`, a little above its middle (lower for
 * the highest ones, so the arm can still hang down to it from the top of its mast).
 */
export function idleWrist(c: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const r = Math.hypot(c.x, c.z);
  const s = r > 1e-6 ? IDLE_R / r : 0;
  return out.set(c.x * s, Math.min(c.y + 0.9, SHOULDER_MAX - HANG * 0.99), r > 1e-6 ? c.z * s : IDLE_R);
}

/** The idle pose for a wrist: hanging from high above, so it stays clear of the spiral. */
export const idlePose = (wrist: THREE.Vector3, out?: ArmPose) => solveArm(wrist, out, HANG);

/** The fingertips on a cartridge at a pose (scale 1): just under the middle of its top edge. */
export function gripOn(pose: { position: THREE.Vector3; quaternion: THREE.Quaternion }, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 1.25 - GRIP_DEPTH, 0).applyQuaternion(pose.quaternion).add(pose.position);
}

/** The world yaw a cartridge turned by `q` faces (its label's normal). */
export function faceYaw(q: THREE.Quaternion): number {
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(z.x, z.z);
}

/** The roll that lines the fingers up across a cartridge facing world yaw `face`, for an arm at `armYaw`. */
export const handRoll = (armYaw: number, face: number) => armYaw - face + Math.PI / 2;

const _pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

const _wrist = new THREE.Vector3();
const _grip = new THREE.Vector3();
const _pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
const ease = (a: number, b: number, k: number) => a + (b - a) * k;
const easeAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function Arm({ quality, reduced }: { quality: QualityTier; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const arm = useMemo(() => build(quality), [quality]);
  const st = useRef({ pose: idlePose(new THREE.Vector3(0, 6, IDLE_R)), want: armPose(), roll: Math.PI / 2, closed: 0, glow: 0, following: false, reachFrom: new THREE.Vector3() });
  useEffect(() => () => arm.dispose(), [arm]);
  // A fresh room: the spiral stands in place.
  useEffect(() => () => void (spiralLift.level = 0), []);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 1 / 30);
    // The lift keeps real time (a slow frame doesn't slow it): the drag's put-back counts on it.
    const lag = Math.min(delta, 0.25);
    const s = st.current;
    const p = s.pose;
    let wantRoll = s.roll;
    let wantClosed = 0;
    let exact = false;
    // What the hand is to do: the drag's task; the machine's plug-in (a click, the scroll, or a dropped
    // cartridge's insert), which the arm carries from the slot to the port; or look about.
    const u = plug.progress;
    const following = !armTask.active && u > 0 && u < PHASE.click[1];
    if (following && !s.following) s.reachFrom.copy(armTask.hand);
    s.following = following;
    const liftBefore = spiralLift.level;
    if (armTask.active) {
      solveArm(wristAbove(armTask.grip, _wrist), s.want);
      wantRoll = handRoll(s.want.yaw, armTask.handYaw);
      wantClosed = armTask.closed;
      exact = true;
      spiralLift.level = stepLift(spiralLift.level, armTask.liftWant, lag, reduced);
    } else if (following) {
      cartridgePose(plug.slot, u, _pose, plug.held);
      gripOn(_pose, _grip);
      if (!plug.held && u < PHASE.reach[1]) {
        // Reaching the slot from wherever the hand was, coming down onto the top edge; closing at the end.
        const k = u / PHASE.reach[1];
        const e = k * k * (3 - 2 * k);
        _grip.lerpVectors(s.reachFrom, _grip, e).setY(_grip.y + 0.45 * Math.sin(Math.PI * Math.min(1, e * 1.15)));
        wantClosed = Math.max(0, (k - 0.75) / 0.25);
      } else wantClosed = 1;
      solveArm(wristAbove(_grip, _wrist), s.want);
      wantRoll = handRoll(s.want.yaw, faceYaw(_pose.quaternion));
      exact = true;
      spiralLift.level = liftAt(u, plug.held);
    } else {
      // Nothing to carry: the spiral comes (or stays) down; the plug-in's own lift brings it down after a click.
      spiralLift.level = u >= PHASE.click[1] && u < 1 ? liftAt(u, plug.held) : stepLift(spiralLift.level, 0, lag, reduced);
      idlePose(idleWrist(lookTarget(_look), _wrist), s.want);
      wantRoll = Math.PI / 2;
      const breathe = quality.idleMotion && !reduced ? Math.sin(clock.elapsedTime * 0.9) * 0.03 : 0;
      s.want.shoulder += breathe;
      s.want.elbow -= breathe * 1.4;
      s.want.wrist = Math.PI - s.want.shoulder - s.want.elbow;
    }
    // Steered, the hand is exactly where it is told (the cartridge hangs from it); on its own it eases.
    const k = exact || reduced ? 1 : 1 - Math.exp(-dt * 2.6);
    const before = p.yaw + p.shoulderY + p.shoulder + p.elbow + p.ext + s.roll;
    p.yaw = easeAngle(p.yaw, s.want.yaw, k);
    p.shoulderY = ease(p.shoulderY, s.want.shoulderY, k);
    p.shoulder = ease(p.shoulder, s.want.shoulder, k);
    p.elbow = ease(p.elbow, s.want.elbow, k);
    p.wrist = ease(p.wrist, s.want.wrist, k);
    p.ext = ease(p.ext, s.want.ext, k);
    s.roll = easeAngle(s.roll, wantRoll, exact || reduced ? 1 : 1 - Math.exp(-dt * 6));
    const kc = reduced ? 1 : 1 - Math.exp(-dt * 14);
    s.closed = ease(s.closed, wantClosed, kc);
    s.glow = ease(s.glow, armTask.active ? 0.6 + 0.9 * armTask.glow : following ? 0.9 : 0.35, kc);

    arm.mast.scale.y = p.shoulderY - ARM.floor - ARM.foot;
    arm.yaw.position.y = p.shoulderY - ARM.floor;
    arm.yaw.rotation.y = p.yaw;
    arm.shoulder.rotation.x = p.shoulder;
    arm.elbow.rotation.x = p.elbow;
    arm.sleeve.scale.y = ARM.fore * 0.2 + p.ext;
    arm.wrist.position.y = ARM.fore + p.ext;
    arm.wrist.rotation.x = p.wrist;
    arm.roll.rotation.y = s.roll;
    const half = FINGER_OPEN + (FINGER_SHUT - FINGER_OPEN) * s.closed;
    arm.fingerA.position.x = half;
    arm.fingerB.position.x = -half;
    arm.glow.value = power.level;
    arm.handGlow.value = power.level * s.glow * 2;

    // Where the fingertips are now (a task starts from there).
    armPoints(p, _pts);
    armTask.hand.copy(_pts[3]);
    armTask.handYawNow = p.yaw - s.roll + Math.PI / 2;

    const after = p.yaw + p.shoulderY + p.shoulder + p.elbow + p.ext + s.roll;
    if (exact || Math.abs(after - before) > 1e-4 || Math.abs(s.closed - wantClosed) > 0.002 || spiralLift.level !== liftBefore || spiralLift.level > 0) invalidate();
  });

  return <primitive object={arm.root} />;
}
