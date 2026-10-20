// The machine's hologram, Iron Man style: the robot twin (T1's Franka, from its URDF) drawn as teal
// light, points scattered over every link's surface plus its edges as lines, standing on a ring of
// light above the projector's lens and replaying a real, sim-verified demo (public/world/
// demo-episode.json) in a loop. The cube and the bin are drawn the same way; while the gripper is
// closed its links turn amber. Particles rise from the lens into it, and two readout panels float
// beside it (what is playing; the joints, live). Everything is additive light: no lit materials, no
// shadows, one draw call per link for the points and one for the edges.
//
// `level` (0–1, the machine's projection) fades it in and out; it costs nothing while it is 0.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { applyJoints, binParts, CUBE_SIZE, FRANKA, quat } from "../../twin/model";
import { parseEpisode, stateAt, type Episode } from "../../twin/replay";
import type { QualityTier } from "../core/quality";
import { SOFT_LINE_GLSL } from "./materials";

const EPISODE_URL = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/")}world/demo-episode.json`;
const TEAL = new THREE.Color("#19f5c2");
const AMBER = new THREE.Color("#ffb000");
/** Metres of hologram per metre of robot: the Franka is about 1 m, the hologram about 2.6 m. */
export const HOLO_SCALE = 2.0;
/** Seconds the end pose holds before the demo loops. */
const HOLD_S = 1.6;
/** The hologram floats this far above the lens, on a beam of rising particles. */
export const LIFT = 2.4;

/** Points per tier, over the whole robot (split by link surface area). */
function budget(q: QualityTier): number {
  return q.name === "low" ? 5000 : q.name === "ultra" ? 34000 : 16000;
}

const pointVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uLevel, uSize, uPR, uScan;
  uniform vec3 uColor;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    // A scan band climbing the robot, and a shimmer per point.
    float band = smoothstep(0.35, 0.0, abs(fract(world.y * 0.22 - uTime * 0.35) - 0.5));
    float shimmer = 0.65 + 0.35 * sin(uTime * (3.0 + aSeed * 5.0) + aSeed * 40.0);
    vA = uLevel * shimmer * (0.45 + 0.9 * band * uScan);
    vColor = uColor * (0.8 + 0.6 * band);
    gl_PointSize = min(uSize * uPR * (0.6 + aSeed) * (12.0 / max(0.5, -mv.z)), 4.0 * uPR);
  }
`;
const pointFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.0 - r) * vA);
  }
`;

function pointMaterial(color: THREE.Color, size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: size },
      uPR: { value: 1 },
      uScan: { value: 1 },
      uColor: { value: color.clone() },
    },
  });
}

/** n points spread over a mesh's surface, area-weighted, each with a random seed. */
function samplePoints(geometry: THREE.BufferGeometry, n: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cum = new Float32Array(tris);
  let total = 0;
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    total += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    cum[i] = total;
  }
  const out = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const r = Math.random() * total;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    a.fromBufferAttribute(pos, lo * 3);
    b.fromBufferAttribute(pos, lo * 3 + 1);
    c.fromBufferAttribute(pos, lo * 3 + 2);
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    out[k * 3] = a.x + (b.x - a.x) * u + (c.x - a.x) * v;
    out[k * 3 + 1] = a.y + (b.y - a.y) * u + (c.y - a.y) * v;
    out[k * 3 + 2] = a.z + (b.z - a.z) * u + (c.z - a.z) * v;
    seed[k] = Math.random();
  }
  if (g !== geometry) g.dispose();
  const res = new THREE.BufferGeometry();
  res.setAttribute("position", new THREE.BufferAttribute(out, 3));
  res.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return res;
}

function areaOf(geometry: THREE.BufferGeometry): number {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  if (g !== geometry) g.dispose();
  return total;
}

interface Holo {
  root: THREE.Group;
  robot: URDFRobot;
  /** Per link mesh: its points and edge materials, and whether it is part of the gripper. */
  parts: { points: THREE.ShaderMaterial; edges: THREE.LineBasicMaterial; gripper: boolean }[];
  cube: THREE.Group;
  bin: THREE.Group;
  dispose: () => void;
}

/** Turn the loaded URDF into light: hide its meshes, hang points and edges on the same links. */
function buildHolo(robot: URDFRobot, nPoints: number): Holo {
  const disposables: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  robot.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  const gripperNames = new Set(FRANKA.gripperLinks);
  const inGripper = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (gripperNames.has(p.name)) return true;
    return false;
  };
  const areas = meshes.map((m) => areaOf(m.geometry));
  const sum = areas.reduce((s, a) => s + a, 0) || 1;
  const parts: Holo["parts"] = [];
  meshes.forEach((m, i) => {
    m.visible = false;
    const n = Math.max(60, Math.round((nPoints * areas[i]) / sum));
    const pg = samplePoints(m.geometry, n);
    const pm = pointMaterial(TEAL, 1.0);
    const pts = new THREE.Points(pg, pm);
    pts.position.copy(m.position);
    pts.quaternion.copy(m.quaternion);
    pts.scale.copy(m.scale);
    pts.frustumCulled = false;
    const eg = new THREE.EdgesGeometry(m.geometry, 28);
    const em = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const edges = new THREE.LineSegments(eg, em);
    edges.position.copy(m.position);
    edges.quaternion.copy(m.quaternion);
    edges.scale.copy(m.scale);
    edges.frustumCulled = false;
    m.parent?.add(pts, edges);
    parts.push({ points: pm, edges: em, gripper: inGripper(m) });
    disposables.push(pg, pm, eg, em);
  });

  // The cube (amber) and the open bin (teal), as edges and a few points.
  const boxEdges = (size: readonly number[], color: THREE.Color) => {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2]));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    disposables.push(g, m);
    return new THREE.LineSegments(g, m);
  };
  const cube = new THREE.Group();
  cube.add(boxEdges([CUBE_SIZE, CUBE_SIZE, CUBE_SIZE], AMBER));
  const bin = new THREE.Group();
  for (const p of binParts()) {
    const e = boxEdges(p.size, TEAL);
    e.position.set(...p.center);
    bin.add(e);
  }

  // The sim's frame is z up; the world's is y up.
  const root = new THREE.Group();
  const zup = new THREE.Group();
  zup.rotation.x = -Math.PI / 2;
  zup.add(robot, cube, bin);
  root.add(zup);
  root.scale.setScalar(HOLO_SCALE);
  return { root, robot, parts, cube, bin, dispose: () => disposables.forEach((d) => d.dispose()) };
}

/** The rings of light the hologram stands on: radius and half width (m), brightness (x the level). */
export const BASE_RINGS = [
  { r: 1.55, w: 0.02, a: 0.45 },
  { r: 1.15, w: 0.012, a: 0.45 },
  { r: 0.5, w: 0.03, a: 0.8 },
] as const;
/** Tick marks round the outer ring (a dial): `arcs` arcs, each `arc` radians long, turning. */
export const DIAL = { r: 1.74, w: 0.04, a: 0.5, arcs: 3, arc: Math.PI / 2.4, turn: 0.25 } as const;
/** Half the quad they are all drawn on: past the dial, with room for the soft edge. */
export const BASE_HALF = 1.9;

const f4 = (x: number) => x.toFixed(4);

/**
 * The rings and the dial in one shader on one quad, each a soft-edged line (materials.ts softLine).
 * They were six meshes with hard edges 2–6 cm wide: from the machine's views a pixel or less, so they
 * broke up and crawled as the camera moved.
 */
export function baseRingsShader(): THREE.ShaderMaterialParameters {
  const rings = BASE_RINGS.map((g) => `a += ${f4(g.a)} * softLine(r - ${f4(g.r)}, px, ${f4(g.w)});`).join("\n        ");
  return {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: { uLevel: { value: 0 }, uRot: { value: 0 }, uColor: { value: TEAL.clone() } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel, uRot;
      uniform vec3 uColor;
      varying vec2 vP;
      ${SOFT_LINE_GLSL}
      void main() {
        float r = length(vP);
        float px = pixelOf(r);
        float a = 0.0;
        ${rings}
        // The dial: lit where the angle (turned by uRot) is inside an arc's span, soft at its ends.
        float seg = ${f4((Math.PI * 2) / DIAL.arcs)};
        float halfArc = ${f4(DIAL.arc / 2)};
        float th = mod(atan(vP.y, vP.x) - uRot, seg);
        float pt = max(length(dFdx(vP)), length(dFdy(vP))) + 1e-6;
        float inArc = clamp(0.5 - (abs(th - halfArc) - halfArc) * r / pt, 0.0, 1.0);
        a += ${f4(DIAL.a)} * softLine(r - ${f4(DIAL.r)}, px, ${f4(DIAL.w)}) * inArc;
        gl_FragColor = vec4(uColor, a * uLevel);
        #include <colorspace_fragment>
      }`,
  };
}

/** The rings of light the hologram stands on, and the particles rising from the lens into it. */
function useBase(nRise: number) {
  return useMemo(() => {
    const group = new THREE.Group();
    const ringsMat = new THREE.ShaderMaterial(baseRingsShader());
    const rings = new THREE.Mesh(new THREE.PlaneGeometry(BASE_HALF * 2, BASE_HALF * 2), ringsMat);
    rings.rotation.x = -Math.PI / 2;
    group.add(rings);
    // Rising particles: a column from the lens up to the ring.
    const pos = new Float32Array(nRise * 3);
    const seed = new Float32Array(nRise);
    for (let i = 0; i < nRise; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 0.55;
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.sin(a) * rr;
      seed[i] = Math.random();
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    rg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const riseMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uPR: { value: 1 }, uH: { value: LIFT }, uColor: { value: TEAL.clone() } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime, uLevel, uPR, uH;
        varying float vA;
        void main() {
          vec3 p = position;
          float y = fract(p.y + uTime * (0.25 + aSeed * 0.35));
          p.y = -y * uH;
          p.xz *= 1.0 + y * 1.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = uLevel * (1.0 - y) * y * 3.0;
          gl_PointSize = min(uPR * (1.0 + aSeed * 2.0) * (10.0 / max(0.5, -mv.z)), 3.0 * uPR);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(uColor, (1.0 - r) * vA);
        }`,
    });
    const rise = new THREE.Points(rg, riseMat);
    rise.frustumCulled = false;
    group.add(rise);
    const dispose = () => {
      rings.geometry.dispose();
      ringsMat.dispose();
      rg.dispose();
      riseMat.dispose();
    };
    return { group, ringsMat, riseMat, dispose };
  }, [nRise]);
}

/** A floating readout: a canvas drawn as light, redrawn a few times a second. */
function usePanel(w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void) {
  return useMemo(() => {
    const W = 512;
    const H = Math.round((512 * h) / w);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const redraw = () => {
      g.clearRect(0, 0, W, H);
      // The panel's glass: a faint fill, a hairline frame, corner brackets.
      g.fillStyle = "rgba(25,245,194,0.06)";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(25,245,194,0.55)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, W - 2, H - 2);
      g.lineWidth = 5;
      const k = 26;
      for (const [x, y, dx, dy] of [
        [0, 0, 1, 1],
        [W, 0, -1, 1],
        [0, H, 1, -1],
        [W, H, -1, -1],
      ]) {
        g.beginPath();
        g.moveTo(x + dx * k, y);
        g.lineTo(x, y);
        g.lineTo(x, y + dy * k);
        g.stroke();
      }
      draw(g, W, H);
      // Scanlines.
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
      tex.needsUpdate = true;
    };
    return { mesh, mat, redraw, dispose: () => (mesh.geometry.dispose(), mat.dispose(), tex.dispose()) };
  }, [w, h, draw]);
}

const MONO = '"Geist Mono", ui-monospace, Consolas, monospace';

export function HoloTwin({ level, quality, label, position }: { level: () => number; quality: QualityTier; label: string; position: THREE.Vector3Tuple }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [holo, setHolo] = useState<Holo | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const base = useBase(quality.name === "low" ? 300 : 900);
  const live = useRef({ step: 0, joints: [] as number[], gripper: 0 as 0 | 1 | null });
  const nPoints = budget(quality);

  // The robot (URDF + collision meshes) and the demo, once. urdf-loader comes with the robot, in its
  // own chunk, so the world's first load doesn't wait for it.
  useEffect(() => {
    let dead = false;
    let built: Holo | null = null;
    import("../../twin/loadTwinRobot")
      .then((m) => m.loadTwinRobot())
      .then((t) => {
        if (dead) return;
        built = buildHolo(t.robot, nPoints);
        setHolo(built);
      })
      .catch((e) => console.warn("world: the hologram's robot didn't load", e));
    fetch(EPISODE_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => !dead && setEpisode(parseEpisode(body)))
      .catch((e) => console.warn("world: the hologram's demo didn't load", e));
    return () => {
      dead = true;
      built?.dispose();
    };
  }, [nPoints]);
  useEffect(() => () => base.dispose(), [base]);

  const info = usePanel(
    2.2,
    1.0,
    useMemo(
      () => (g: CanvasRenderingContext2D, W: number) => {
        g.fillStyle = "#19f5c2";
        g.font = `500 20px ${MONO}`;
        g.fillText("REPLAY · VERIFIED COPY", 28, 48);
        g.font = `700 44px ${MONO}`;
        g.fillStyle = "#d8efe9";
        g.fillText(label.toUpperCase(), 28, 106);
        g.font = `400 19px ${MONO}`;
        g.fillStyle = "#8fb0a8";
        g.fillText("FRANKA FR3 · PICK CUBE → BIN", 28, 150);
        g.fillText(`${episode ? episode.nSteps : "…"} STEPS · ${episode ? episode.fps : 30} HZ · ISAAC LAB`, 28, 180);
        g.fillStyle = "#ffb000";
        g.fillText("PHYSICS CHECK: PASSED", 28, 216);
        void W;
      },
      [label, episode],
    ),
  );
  const joints = usePanel(
    1.7,
    1.45,
    useMemo(
      () => (g: CanvasRenderingContext2D, W: number) => {
        const L = live.current;
        g.fillStyle = "#19f5c2";
        g.font = `500 20px ${MONO}`;
        g.fillText("JOINTS · LIVE", 28, 48);
        for (let i = 0; i < 7; i++) {
          const v = L.joints[i] ?? 0;
          const y = 82 + i * 46;
          g.fillStyle = "#8fb0a8";
          g.font = `400 18px ${MONO}`;
          g.fillText(`J${i + 1}`, 28, y + 16);
          g.fillStyle = "rgba(25,245,194,0.18)";
          g.fillRect(80, y, W - 230, 18);
          g.fillStyle = "#19f5c2";
          const u = Math.min(1, Math.max(0, (v + Math.PI) / (2 * Math.PI)));
          g.fillRect(80, y, (W - 230) * u, 18);
          g.fillStyle = "#d8efe9";
          g.fillText(v.toFixed(2), W - 132, y + 16);
        }
        g.fillStyle = L.gripper === 1 ? "#ffb000" : "#8fb0a8";
        g.font = `700 20px ${MONO}`;
        g.fillText(L.gripper === 1 ? "GRIPPER · CLOSED" : "GRIPPER · OPEN", 28, 82 + 7 * 46 + 18);
      },
      [],
    ),
  );
  useEffect(() => () => (info.dispose(), joints.dispose()), [info, joints]);
  useEffect(() => info.redraw(), [info]);

  const st = useRef({ t0: -1, lastDraw: 0, lastStep: -1 });
  useFrame(({ clock, camera }) => {
    const lv = level();
    const visible = lv > 0.001;
    if (holo) holo.root.visible = visible;
    base.group.visible = visible;
    info.mesh.visible = joints.mesh.visible = visible;
    if (!visible) {
      st.current.t0 = -1;
      return;
    }
    const now = clock.elapsedTime;
    if (st.current.t0 < 0) st.current.t0 = now;
    const pr = gl.getPixelRatio();
    const flicker = 0.92 + 0.08 * Math.sin(now * 31) * Math.sin(now * 7.7);
    const a = lv * flicker;

    // The demo, looping, with a hold on its last pose.
    if (holo && episode && episode.nSteps > 0) {
      const span = episode.nSteps / episode.fps + HOLD_S;
      const tt = ((now - st.current.t0) % span) * episode.fps;
      const step = Math.min(episode.nSteps - 1, Math.floor(tt));
      if (step !== st.current.lastStep) {
        st.current.lastStep = step;
        const s = stateAt(episode, step);
        if (s.joints) {
          applyJoints(holo.robot, s.joints);
          live.current.joints = Object.keys(s.joints)
            .filter((k) => k.startsWith("panda_joint"))
            .sort()
            .map((k) => s.joints![k]);
        }
        live.current.gripper = s.gripper;
        if (s.cube) {
          holo.cube.position.set(...s.cube.pos);
          holo.cube.quaternion.copy(quat(s.cube.quat));
        }
        if (s.bin) {
          holo.bin.position.set(...s.bin.pos);
          holo.bin.quaternion.copy(quat(s.bin.quat));
        }
      }
    }
    if (holo) {
      const closed = live.current.gripper === 1;
      for (const p of holo.parts) {
        const u = p.points.uniforms;
        u.uTime.value = now;
        u.uLevel.value = a;
        u.uPR.value = pr;
        u.uColor.value.copy(p.gripper && closed ? AMBER : TEAL);
        p.edges.opacity = 0.55 * a;
        p.edges.color.copy(p.gripper && closed ? AMBER : TEAL);
      }
      holo.cube.traverse((o) => o instanceof THREE.LineSegments && ((o.material as THREE.LineBasicMaterial).opacity = 0.95 * a));
      holo.bin.traverse((o) => o instanceof THREE.LineSegments && ((o.material as THREE.LineBasicMaterial).opacity = 0.6 * a));
    }
    base.ringsMat.uniforms.uLevel.value = a;
    base.ringsMat.uniforms.uRot.value = now * DIAL.turn;
    base.riseMat.uniforms.uTime.value = now;
    base.riseMat.uniforms.uLevel.value = lv;
    base.riseMat.uniforms.uPR.value = pr;
    info.mat.opacity = 0.9 * a;
    joints.mat.opacity = 0.9 * a;
    // The panels face the camera (turning round y only), like screens held in the air.
    for (const m of [info.mesh, joints.mesh]) {
      const wp = m.getWorldPosition(new THREE.Vector3());
      m.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z) - (m.parent ? m.parent.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion()) * 0 : 0);
    }
    if (now - st.current.lastDraw > 0.2) {
      st.current.lastDraw = now;
      joints.redraw();
    }
    invalidate();
  });

  return (
    <group position={[position[0], position[1] + LIFT, position[2]]}>
      {/* The ring on the lens, the robot standing on it. */}
      <primitive object={base.group} />
      {holo ? <primitive object={holo.root} /> : null}
      <group position={[-2.5, 1.2, 0.4]}>
        <primitive object={info.mesh} />
      </group>
      <group position={[2.4, 1.0, 0.4]}>
        <primitive object={joints.mesh} />
      </group>
    </group>
  );
}
