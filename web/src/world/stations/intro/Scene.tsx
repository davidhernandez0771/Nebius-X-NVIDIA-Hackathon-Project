// The opening in 3D: the logo (mark + plumes) as particles with the iridescent ring around it, and the
// dust through the whole journey. Scrolling the intro sends the logo's particles up in an arc and down
// onto the roof lattice over the ceiling, and the ring down onto the skylight's rim. It is also the
// loader's real work: the mark image, the particles for the tier, and every shader compiled before
// the loader lets go (progress.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { onPointer, pointer } from "../../ui/pointer";
import { DUST, LOGO, LOGO_SCALE, RING, SKYLIGHT } from "./layout";
import { MARK_URL } from "./mark";
import { drawPlaceholderMark, dustBuffers, logoBuffers, sampleMark } from "./particles";
import { load } from "./progress";
import { dustFrag, dustVert, logoFrag, logoPointSize, logoVert } from "./shaders";

const MARK_PX = 512;
/** Seconds for the logo to gather out of the scatter once the loader lets go. */
export const GATHER_S = 2.2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The mark's opaque pixels: the image at MARK_URL, or the placeholder if it can't load. */
function useMark(): Float32Array | null {
  const [mark, setMark] = useState<Float32Array | null>(null);
  useEffect(() => {
    let live = true;
    const sample = (draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement("canvas");
      c.width = c.height = MARK_PX;
      const g = c.getContext("2d");
      if (!g) return new Float32Array(0);
      draw(g);
      return sampleMark(g.getImageData(0, 0, MARK_PX, MARK_PX).data, MARK_PX, MARK_PX);
    };
    // Through three's loading manager, so the loader counts it (drei's useProgress).
    new THREE.ImageLoader().load(
      MARK_URL,
      (img) => live && setMark(sample((g) => g.drawImage(img, 0, 0, MARK_PX, MARK_PX))),
      undefined,
      () => live && setMark(sample((g) => drawPlaceholderMark(g, MARK_PX))),
    );
    return () => {
      live = false;
    };
  }, [setMark]);
  return mark;
}

function makeLogo(mark: Float32Array, n: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const b = logoBuffers(mark, n);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("aRoof", new THREE.BufferAttribute(b.roof, 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(b.rand, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -8, 0), 45);
  const m = new THREE.ShaderMaterial({
    vertexShader: logoVert,
    fragmentShader: logoFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uT: { value: 0 },
      uIntro: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: logoPointSize(n) },
      uPR: { value: 1 },
      uDist: { value: 30 * LOGO_SCALE },
      uColA: { value: new THREE.Color("#bfe85c") },
      uColB: { value: new THREE.Color("#19f5c2") },
      uColC: { value: new THREE.Color("#ffffff") },
    },
  });
  const p = new THREE.Points(g, m);
  p.position.set(...LOGO);
  p.scale.setScalar(LOGO_SCALE);
  p.name = "intro:logo";
  p.raycast = () => {};
  return p;
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
      uSize: { value: 1.2 },
      uY0: { value: DUST.y0 },
      uH: { value: DUST.height },
      uHigh: { value: new THREE.Color("#a9d860") },
      uLow: { value: new THREE.Color("#2fbfa0") },
      uWarm: { value: new THREE.Color("#ff9a4a") },
    },
  });
  const p = new THREE.Points(g, m);
  p.name = "intro:dust";
  p.raycast = () => {};
  return p;
}

function useRing(lowTier: boolean) {
  const gl = useThree((s) => s.gl);
  return useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
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
    const geo = new THREE.TorusGeometry(RING.radius, RING.tube, lowTier ? 24 : 48, lowTier ? 96 : 200);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "intro:ring";
    mesh.raycast = () => {};
    return { mesh, mat, dispose: () => (geo.dispose(), mat.dispose(), env.dispose()) };
  }, [gl, lowTier]);
}

export function IntroScene({ frame, quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const mark = useMark();
  const ring = useRing(quality.name === "low");
  const logo = useMemo(() => (mark ? makeLogo(mark, quality.logoParticles) : null), [mark, quality.logoParticles]);
  const dust = useMemo(() => makeDust(quality.dustParticles), [quality.dustParticles]);
  const st = useRef({ readyAt: null as number | null, mx: 0, my: 0 });

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
  useEffect(() => () => dust.geometry.dispose(), [dust]);
  useEffect(() => () => logo?.geometry.dispose(), [logo]);
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
    const r = gl as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    if (r.compileAsync) r.compileAsync(scene, camera).then(done, done);
    else {
      gl.compile(scene, camera);
      done();
    }
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
    const gather = reduced ? 1 : s.readyAt === null ? 0 : clamp01((now - s.readyAt) / GATHER_S);
    const t = frame.t;
    const k = 1 - Math.exp(-dt * 4);
    s.mx += (pointer.x - s.mx) * k;
    s.my += (pointer.y - s.my) * k;
    const pr = gl.getPixelRatio();

    // The logo's particles → the roof; the ring → the skylight's rim.
    const uT = smooth(0.16, 0.86, t);
    const tt = smooth(0.24, 0.96, t);
    if (logo) {
      const u = logo.material.uniforms;
      u.uT.value = uT;
      u.uIntro.value = gather;
      u.uTime.value = now;
      u.uPR.value = pr;
      logo.rotation.set(-s.my * 0.3 * (1 - uT), s.mx * 0.45 * (1 - uT), 0);
    }
    ring.mesh.position.set(lerp(LOGO[0], SKYLIGHT.center[0], tt), lerp(LOGO[1], SKYLIGHT.center[1], tt), lerp(LOGO[2], SKYLIGHT.center[2], tt));
    ring.mesh.scale.setScalar(lerp(LOGO_SCALE, SKYLIGHT.radius / RING.radius, tt));
    ring.mesh.rotation.set(lerp(-s.my * 0.35, Math.PI / 2, tt), s.mx * 0.45 * (1 - tt), now * 0.12 * tt);
    ring.mat.iridescenceThicknessRange[1] = 700 + 220 * Math.sin(now * 0.7 + s.mx * 2);
    ring.mesh.visible = gather > 0 || tt > 0;

    const du = dust.material.uniforms;
    du.uTime.value = now;
    du.uPR.value = pr;
    du.uMix.value = store.frames.workshop.arrive;

    // Gathering plays on every tier; the drift after it only where idle loops are allowed.
    const branch = store.getCoarse().branch !== null;
    const drifting = quality.idleMotion && !reduced && !branch;
    if ((ready && gather < 1) || drifting || Math.abs(pointer.x - s.mx) + Math.abs(pointer.y - s.my) > 0.002) invalidate();
  });

  return (
    <group>
      <primitive object={ring.mesh} />
      {logo ? <primitive object={logo} /> : null}
      <primitive object={dust} />
    </group>
  );
}
