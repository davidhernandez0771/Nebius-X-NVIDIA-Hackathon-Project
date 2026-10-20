// The opening in 3D, after Active Theory's hero: a clean dark space (the backdrop, sparse dust) with
// the SANT logo turning slowly in the middle as a glass object, built from mark.svg (logo3d.ts). The
// scroll turns and leans it (storyPlan.ts) while the words come and go beside it (Story.tsx); at the end
// it becomes the ring: the core spins away into the centre and the ring's tube grows round the arcs.
// As the descent starts, the ring bursts into the particles that build the workshop
// (stations/descent/Generator.tsx), its tube shrinking to nothing. High and ultra draw real glass
// (transmission, with dispersion on ultra); low and phones get polished iridescent chrome, no refraction.
// It is also the loader's real work: the mark, the logo built for the tier, and every shader compiled
// before the loader lets go (progress.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ambient } from "../../core/activity";
import { compileSafe, type Compiler } from "../../core/compile";
import type { QualityTier } from "../../core/quality";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { onPointer, pointer } from "../../ui/pointer";
import { DUST, fitFor, LOGO, LOGO_R, logoFit, RING } from "./layout";
import { extrudeLogo, logoShapes } from "./logo3d";
import { MARK_URL } from "./mark";
import { dustBuffers } from "./particles";
import { load } from "./progress";
import { backdropFrag, backdropVert, dustFrag, dustVert } from "./shaders";
import { INTRO_VH, logoPose } from "./storyPlan";

/** Seconds for the logo to grow in once the loader lets go. */
export const GATHER_S = 1.6;
/** The slow turn of its own, radians a second (on top of the scroll's turn), where idle loops run. */
const SPIN = 0.12;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (u: number) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;

/** The mark's SVG text, through three's loading manager (so the loader counts it). Null until it arrives. */
function useMarkSvg(): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    new THREE.FileLoader().load(
      MARK_URL,
      (text) => live && setSvg(String(text)),
      undefined,
      () => live && setSvg(FALLBACK_MARK),
    );
    return () => {
      live = false;
    };
  }, []);
  return svg;
}

/** The placeholder mark, if mark.svg can't load: four arcs, four ticks, the diamond. */
const FALLBACK_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g fill="none" stroke="#fff" stroke-linecap="round">
<path d="M376.7 298.7 A128 128 0 0 1 298.7 376.7" stroke-width="22"/><path d="M213.3 376.7 A128 128 0 0 1 135.3 298.7" stroke-width="22"/>
<path d="M135.3 213.3 A128 128 0 0 1 213.3 135.3" stroke-width="22"/><path d="M298.7 135.3 A128 128 0 0 1 376.7 213.3" stroke-width="22"/>
<path d="M297 297 L321.1 321.1" stroke-width="14"/><path d="M215 297 L190.9 321.1" stroke-width="14"/>
<path d="M215 215 L190.9 190.9" stroke-width="14"/><path d="M297 215 L321.1 190.9" stroke-width="14"/></g>
<path d="M256 228 L284 256 L256 284 L228 256 Z" fill="#fff"/></svg>`;

/** A small prefiltered studio for the glass and the chrome to reflect. */
function useStudio(): THREE.Texture {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const t = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  return env;
}

/** Glass where the GPU can afford the extra transmission pass; iridescent chrome where it can't. */
function logoMaterial(q: QualityTier, env: THREE.Texture): THREE.MeshPhysicalMaterial {
  if (q.name === "low")
    return new THREE.MeshPhysicalMaterial({
      color: 0x9aa4a8,
      metalness: 1,
      roughness: 0.16,
      iridescence: 0.6,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [240, 640],
      envMap: env,
      envMapIntensity: 1.2,
    });
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.05,
    transmission: 1,
    // In the logo's own units (the ring's radius is 1): about a metre of glass at its scale.
    thickness: 0.22,
    ior: 1.5,
    dispersion: q.name === "ultra" ? 5 : 2.5,
    attenuationColor: new THREE.Color("#c4f6ea"),
    attenuationDistance: 0.9,
    iridescence: 0.35,
    iridescenceIOR: 1.3,
    specularIntensity: 1,
    envMap: env,
    envMapIntensity: 1.5,
  });
}

interface Logo {
  group: THREE.Group;
  core: THREE.Mesh;
  arcs: THREE.Mesh;
  dispose(): void;
}

function makeLogo(svg: string, q: QualityTier, env: THREE.Texture): Logo {
  const shapes = logoShapes(svg);
  const opts = { depth: 0.16, bevel: 0.035, bevelSegments: q.name === "low" ? 2 : 4 };
  const material = logoMaterial(q, env);
  const arcs = new THREE.Mesh(extrudeLogo(shapes.ring, opts), material);
  const core = new THREE.Mesh(extrudeLogo(shapes.core, opts), material);
  const group = new THREE.Group();
  group.add(arcs, core);
  group.position.set(...LOGO);
  group.scale.setScalar(LOGO_R);
  group.name = "intro:logo";
  for (const m of [arcs, core]) m.raycast = () => {};
  return {
    group,
    core,
    arcs,
    dispose: () => (arcs.geometry.dispose(), core.geometry.dispose(), material.dispose()),
  };
}

/** The portal's ring: iridescent chrome whose tube grows from nothing (uTube 0–1) in the morph. */
function makeRing(lowTier: boolean, env: THREE.Texture) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x8e979b,
    metalness: 1,
    roughness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 820],
    envMap: env,
    envMapIntensity: 0.9,
  });
  const tube = { value: 0 };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTube = tube;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTube;")
      .replace(
        "#include <begin_vertex>",
        // The tube scaled about its own centre line (the ring's circle), so it thickens in place.
        `#include <begin_vertex>
  vec3 ringC = vec3(normalize(transformed.xy) * ${RING.radius.toFixed(3)}, 0.0);
  transformed = ringC + (transformed - ringC) * uTube;`,
      );
  };
  const geo = new THREE.TorusGeometry(RING.radius, RING.tube, lowTier ? 24 : 48, lowTier ? 96 : 200);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...LOGO);
  mesh.scale.setScalar(LOGO_R / RING.radius);
  mesh.name = "intro:ring";
  mesh.raycast = () => {};
  mesh.visible = false;
  return { mesh, mat, tube, dispose: () => (geo.dispose(), mat.dispose()) };
}

function makeBackdrop() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: backdropVert,
    fragmentShader: backdropFrag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uDim: { value: 0 },
      uBase: { value: new THREE.Color("#04080b") },
      uLeak: { value: new THREE.Color("#19f5c2") },
    },
  });
  const geo = new THREE.SphereGeometry(80, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...LOGO);
  // First, behind everything; opaque, so the glass refracts it.
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = "intro:backdrop";
  mesh.raycast = () => {};
  return { mesh, mat, dispose: () => (geo.dispose(), mat.dispose()) };
}

function makeDust(n: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const b = dustBuffers(n);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(b.rand, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, DUST.y0 + DUST.height / 2, 0), Math.hypot(DUST.radius, DUST.height / 2) + 1);
  const m = new THREE.ShaderMaterial({
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPR: { value: 1 },
      uMix: { value: 0 },
      uSize: { value: 1.1 },
      uY0: { value: DUST.y0 },
      uH: { value: DUST.height },
      uHigh: { value: new THREE.Color("#a9d8c8") },
      uLow: { value: new THREE.Color("#2fbfa0") },
      uWarm: { value: new THREE.Color("#ff9a4a") },
    },
  });
  const p = new THREE.Points(g, m);
  p.name = "intro:dust";
  p.raycast = () => {};
  return p;
}

export function IntroScene({ frame, quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const svg = useMarkSvg();
  const env = useStudio();
  const low = quality.name === "low";
  const logo = useMemo(() => (svg ? makeLogo(svg, quality, env) : null), [svg, quality, env]);
  const ring = useMemo(() => makeRing(low, env), [low, env]);
  const backdrop = useMemo(() => makeBackdrop(), []);
  // Sparse: a third of the tier's dust, so the space reads empty and deep.
  const dust = useMemo(() => makeDust(Math.round(quality.dustParticles / 3)), [quality.dustParticles]);
  const st = useRef({ readyAt: null as number | null, mx: 0, my: 0, spin: 0 });

  useEffect(() => {
    load.set("canvas", 1);
    // Whatever three's loading manager fetches for the intro (the mark) counts toward the loader.
    const report = ({ loaded, total, active }: { loaded: number; total: number; active: boolean }) => {
      if (total > 0) load.set("assets", active ? loaded / total : 1);
    };
    report(useProgress.getState());
    return useProgress.subscribe(report);
  }, []);
  useEffect(() => () => ring.dispose(), [ring]);
  useEffect(() => () => backdrop.dispose(), [backdrop]);
  useEffect(() => () => dust.geometry.dispose(), [dust]);
  useEffect(() => () => logo?.dispose(), [logo]);
  useEffect(() => onPointer(() => (store.frames.intro.near ? invalidate() : undefined)), [store, invalidate]);

  // Built for the tier, then every shader on screen compiled before the loader lets go.
  useEffect(() => {
    if (!logo) return;
    load.set("assets", 1);
    load.set("build", 1);
    let live = true;
    const done = () => {
      if (!live) return;
      load.set("compile", 1);
      invalidate();
    };
    compileSafe(gl as unknown as Compiler, scene, camera).then(done, done);
    return () => {
      live = false;
    };
  }, [logo, gl, scene, camera, invalidate]);

  useFrame(({ clock }, delta) => {
    const s = st.current;
    const now = clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const ready = store.getCoarse().ready;
    if (ready && s.readyAt === null) s.readyAt = now;
    const grow = reduced ? 1 : s.readyAt === null ? 0 : clamp01((now - s.readyAt) / GATHER_S);
    const k = 1 - Math.exp(-dt * 4);
    s.mx += (pointer.x - s.mx) * k;
    s.my += (pointer.y - s.my) * k;
    const pr = gl.getPixelRatio();

    const vh = frame.t * INTRO_VH;
    const pose = logoPose(vh);
    const fit = (logoFit.value = fitFor(size.width / Math.max(1, size.height)));
    // The descent's first moments: the ring bursts into the generator's particles.
    const burst = smooth(0.02, 0.2, store.frames.descent.t);
    const idle = quality.idleMotion && !reduced;

    if (logo) {
      const free = 1 - pose.morph;
      // Its own slow turn: it slows to a stop in the morph and unwinds (the short way) to square on.
      if (idle) s.spin = (s.spin + dt * SPIN * free) % (Math.PI * 2);
      const spin = (s.spin > Math.PI ? s.spin - Math.PI * 2 : s.spin) * free;
      logo.group.rotation.set(pose.tilt - s.my * 0.14 * free, pose.turn + spin + s.mx * 0.22 * free, 0);
      logo.group.scale.setScalar(LOGO_R * fit * (reduced ? 1 : Math.max(0.001, easeOutBack(grow))));
      // The core spins away into the centre; the arcs stay until the ring's tube has closed over them.
      const coreK = 1 - smooth(0, 0.6, pose.morph);
      logo.core.scale.setScalar(Math.max(0.001, coreK));
      logo.core.rotation.z = (1 - coreK) * Math.PI;
      logo.core.visible = coreK > 0.002;
      logo.group.visible = grow > 0 && pose.morph < 0.97 && burst < 1;
    }
    ring.tube.value = smooth(0.12, 0.85, pose.morph) * (1 - burst);
    ring.mesh.visible = ring.tube.value > 0.002;
    ring.mesh.scale.setScalar((LOGO_R / RING.radius) * fit);
    ring.mesh.rotation.z = now * 0.08;
    ring.mat.iridescenceThicknessRange[1] = 700 + 220 * Math.sin(now * 0.7 + s.mx * 2);

    const b = backdrop.mat.uniforms;
    // The dark space gives way as the camera drops toward the room.
    b.uDim.value = smooth(0.3, 0.7, store.frames.descent.t);
    backdrop.mesh.visible = b.uDim.value < 1;

    const du = dust.material.uniforms;
    du.uTime.value = now;
    du.uPR.value = pr;

    // Growing plays on every tier; the turn of its own only where idle loops are allowed.
    const branch = store.getCoarse().branch !== null;
    if ((ready && grow < 1) || Math.abs(pointer.x - s.mx) + Math.abs(pointer.y - s.my) > 0.002) invalidate();
    else if (idle && !branch && frame.near) ambient(invalidate);
  });

  return (
    <group>
      <primitive object={backdrop.mesh} />
      <primitive object={ring.mesh} />
      {logo ? <primitive object={logo.group} /> : null}
      <primitive object={dust} />
    </group>
  );
}
