// The opening in 3D, after Active Theory's hero: a clean dark space (the backdrop, sparse dust) with
// the SANT mark floating in the middle as a real tesseract (Tesseract.ts): a 4D cube turning in 4D, its teal
// inner cube and chrome outer one turning inside out into each other, one outer corner broken open. The scroll
// turns it in 4D and gently in 3D (tesseractPlan.ts, storyPlan.ts) while the hero's words sit beside it
// (Story.tsx); then the camera sinks below it (path.ts) and the hero goes out into the dark. Below are the places
// the story descends through, the forest and the reactor (Places.tsx), loaded once the loader is done; the
// reactor's top ring is THE RING the descent bursts. Reduced motion holds the flat mark's pose. It is also the
// loader's real work (progress.ts): the engine up, the tesseract built for the tier, every shader compiled
// (counted as each links) and a few steady frames drawn before the loader lets go. The forest and the reactor
// mount once the loader is done and the forest's files have streamed in (core/assets.ts).
import { lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ambient } from "../../core/activity";
import { rooms } from "../../core/rooms";
import { fitFov } from "../../core/fov";
import { compileSafe } from "../../../three/compileSafe";
import type { QualityTier } from "../../core/quality";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { onPointer, pointer } from "../../ui/pointer";
import { heroSlot, type Box } from "./heroSlot";
import { DUST, HERO_VIEW, LOGO, LOGO_R } from "./layout";
import { dustBuffers } from "./particles";
import { FRAMES, frameGate, load } from "./progress";
import { backdropFrag, backdropVert, dustFrag, dustVert } from "./shaders";
import { INTRO_VH, logoPose, placeLights } from "./storyPlan";
import { makeTesseract, TESSERACT_LOOK, type TesseractHandle } from "./Tesseract";
import { HYPER_RADIUS, hyperPose, ISO, STILL_RADIUS } from "./tesseractPlan";

// The forest and the reactor: after the first frame, with their STL loader and shaders.
const Places = lazy(() => import("./Places"));

/** Seconds for the logo to grow in once the loader lets go. */
export const GATHER_S = 1.6;
/** The slow 3D turn of its own, radians a second (on top of the scroll's turn), where idle loops run. */
const SPIN = 0.12;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutBack = (u: number) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;

interface Logo {
  /** Turned by the scroll's gentle 3D turn and the pointer. */
  group: THREE.Group;
  tesseract: TesseractHandle;
  dispose(): void;
}

/** The tesseract, seen as the flat mark (isometric) inside a group the scroll and the pointer turn. */
function makeLogo(q: QualityTier): Logo {
  const tesseract = makeTesseract(q);
  tesseract.group.rotation.copy(ISO);
  const group = new THREE.Group();
  group.add(tesseract.group);
  group.position.set(...LOGO);
  group.scale.setScalar(LOGO_R);
  group.name = "intro:logo";
  return { group, tesseract, dispose: () => tesseract.dispose() };
}

/** The page's boxes the tesseract keeps clear of: the hero's headline and column, the scroll hint, the brand, the
 *  contact button, the station rail, the quality chip. */
const KEEP_CLEAR = [".intro-beat__main", ".intro-beat__col", ".intro-down", ".world-brand", ".world-contact", ".world-rail", ".world-q"];

/** The tesseract is the hero: its still pose about this much of the screen's height, where the space allows. */
const HERO_SIZE = 0.56;
/** The backdrop sphere's radius (makeBackdrop). */
const BACKDROP_R = 80;

interface Placement {
  position: THREE.Vector3;
  /** Of its old fixed size. */
  scale: number;
  /** Where the backdrop's soft glow sits: the direction (from the backdrop's centre) behind the tesseract. */
  glow: THREE.Vector3;
}

/** Where the tesseract floats and how large: as large as HERO_SIZE asks, in the largest space clear of the page's
 *  boxes (heroSlot.ts), so that even its widest 4D reach never covers the type; seen from the hero's camera at the
 *  canvas's size. */
function place(canvas: HTMLCanvasElement, tubeR: number): Placement {
  const c = canvas.getBoundingClientRect();
  const w = c.width || 1, h = c.height || 1;
  const keep: Box[] = [];
  for (const sel of KEEP_CLEAR) {
    const e = document.querySelector(sel);
    const r = e?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) keep.push({ left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top });
  }
  // The rig draws portrait screens with a wider field of view (fov.ts); so does this.
  const fov = fitFov(HERO_VIEW.fov, w / h);
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000);
  cam.position.set(...HERO_VIEW.position);
  cam.lookAt(new THREE.Vector3(...HERO_VIEW.target));
  cam.updateMatrixWorld();
  const forward = cam.getWorldDirection(new THREE.Vector3());
  const depth = new THREE.Vector3(...LOGO).sub(cam.position).dot(forward);
  // Its widest reach (a corner and its ball) at the old size, in pixels at the logo's depth.
  const reach = (HYPER_RADIUS + tubeR * 1.7) * LOGO_R;
  const base = (reach / (depth * Math.tan(THREE.MathUtils.degToRad(fov) / 2))) * (h / 2);
  // The size asked for: the still pose HERO_SIZE of the height, so its reach that much larger again.
  const want = (HERO_SIZE * h) / 2 * (HYPER_RADIUS / STILL_RADIUS);
  const slot = heroSlot({ w, h }, keep, { pad: 16, margin: 12, maxR: want });
  const ray = new THREE.Vector3((slot.cx / w) * 2 - 1, 1 - (slot.cy / h) * 2, 0.5).unproject(cam).sub(cam.position).normalize();
  const position = cam.position.clone().addScaledVector(ray, depth / ray.dot(forward));
  // The glow: where that ray meets the backdrop sphere (centred on LOGO).
  const o = cam.position.clone().sub(new THREE.Vector3(...LOGO));
  const b = o.dot(ray);
  const t = -b + Math.sqrt(Math.max(0, b * b - (o.lengthSq() - BACKDROP_R * BACKDROP_R)));
  const glow = o.addScaledVector(ray, t).normalize();
  return { position, scale: slot.r / base, glow };
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
      uGlow: { value: new THREE.Vector3(0, 0, -1) },
    },
  });
  const geo = new THREE.SphereGeometry(BACKDROP_R, 48, 24);
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
  const logo = useMemo(() => makeLogo(quality), [quality]);
  const backdrop = useMemo(() => makeBackdrop(), []);
  // Sparse: a third of the tier's dust, so the space reads empty and deep.
  const dust = useMemo(() => makeDust(Math.round(quality.dustParticles / 3)), [quality.dustParticles]);
  const st = useRef({ readyAt: null as number | null, mx: 0, my: 0, spin: 0, spin4: 0, frames: null as number[] | null });
  const slot = useRef<Placement>({ position: new THREE.Vector3(...LOGO), scale: 1, glow: new THREE.Vector3(0, 0, -1) });

  // Placed clear of the page's type: on load, as the fonts and the hero's words settle, and on every resize.
  useEffect(() => {
    const tube = TESSERACT_LOOK[quality.name].tube;
    const measure = () => {
      slot.current = place(gl.domElement, tube);
      invalidate();
    };
    measure();
    const timers = [250, 1000, 2500].map((ms) => window.setTimeout(measure, ms));
    document.fonts?.ready.then(measure, () => undefined);
    window.addEventListener("resize", measure);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", measure);
    };
  }, [gl, quality.name, invalidate]);

  // The engine is up: this chunk arrived and the context works.
  useEffect(() => load.set("engine", 1), []);

  // The forest and the reactor mount when the room builder allows them (core/rooms.ts): once their files
  // have streamed in, under the loader if they are in by then.
  const placesAllowed = useSyncExternalStore(rooms.subscribe, () => rooms.allowed("intro:places"));
  // The loader's last step (steady frames) starts once the rooms are built: draw for it.
  useEffect(
    () =>
      load.subscribe(() => {
        if (load.status().step === "frames" && st.current.frames === null && !load.done()) {
          st.current.frames = [];
          invalidate();
        }
      }),
    [invalidate],
  );
  useEffect(() => () => backdrop.dispose(), [backdrop]);
  useEffect(() => () => dust.geometry.dispose(), [dust]);
  useEffect(() => () => logo.dispose(), [logo]);
  useEffect(() => onPointer(() => (store.frames.intro.near ? invalidate() : undefined)), [store, invalidate]);

  // Built for the tier, then every shader on screen compiled, each counted as it links, before the
  // loader goes on to the steady frames.
  useEffect(() => {
    load.set("build", 1);
    let live = true;
    const done = () => {
      if (!live) return;
      load.set("shaders", 1);
      invalidate();
    };
    // The tesseract is hidden until it grows in, and three compiles only what is visible: show it for the compile,
    // so its first frame on screen doesn't stall on its shaders.
    const was = logo.group.visible;
    logo.group.visible = true;
    compileSafe(gl, scene, camera, 10000, (n, total) => live && load.count("shaders", n, total)).then(done, done);
    logo.group.visible = was;
    return () => {
      live = false;
    };
  }, [logo, gl, scene, camera, invalidate]);

  useFrame(({ clock }, delta) => {
    const s = st.current;
    const now = clock.elapsedTime;
    // The loader's last step: frames drawn back to back at a steady time (frameGate). The first one after
    // the compile is skipped (its delta is the wait, not a frame).
    if (s.frames && !load.done()) {
      const first = s.frames.length === 0 && delta > 0.5;
      if (!first) s.frames.push(delta);
      const gate = frameGate(s.frames);
      load.count("frames", gate.done ? FRAMES : gate.steady, FRAMES);
      if (!gate.done) invalidate();
      else s.frames = null;
    }
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
    // The hero goes out into the dark as the camera sinks below it (held with reduced motion).
    const light = reduced ? 1 : placeLights(vh).hero;
    const idle = quality.idleMotion && !reduced;

    // The 4D turn follows the scroll, plus a slow one of its own; the 3D turn is gentle (a third of the scroll's).
    // Both start once it has grown in, so the hero opens on the flat mark's pose.
    if (idle && grow >= 1) {
      s.spin = (s.spin + dt * SPIN) % (Math.PI * 2);
      s.spin4 += dt;
    }
    logo.tesseract.update(hyperPose(vh, s.spin4, reduced));
    const turn = reduced ? 0 : pose.turn / 3 + s.spin;
    logo.group.rotation.set((reduced ? 0 : pose.tilt) - s.my * 0.14, turn + s.mx * 0.22, 0);
    logo.group.position.copy(slot.current.position);
    logo.group.scale.setScalar(LOGO_R * slot.current.scale * (reduced ? 1 : Math.max(0.001, easeOutBack(grow))));
    logo.tesseract.setLight(light);
    logo.group.visible = grow > 0 && light > 0;

    const b = backdrop.mat.uniforms;
    b.uDim.value = 1 - light;
    (b.uGlow.value as THREE.Vector3).copy(slot.current.glow);
    backdrop.mesh.visible = light > 0;
    dust.visible = light > 0;

    const du = dust.material.uniforms;
    du.uTime.value = now;
    du.uPR.value = pr;

    // Growing plays on every tier; the turn of its own only where idle loops are allowed.
    const branch = store.getCoarse().branch !== null;
    if ((ready && grow < 1) || Math.abs(pointer.x - s.mx) + Math.abs(pointer.y - s.my) > 0.002) invalidate();
    else if (idle && !branch && frame.near && light > 0) ambient(invalidate);
  });

  return (
    <group>
      <primitive object={backdrop.mesh} />
      <primitive object={logo.group} />
      <primitive object={dust} />
      {placesAllowed && !reduced ? (
        <Suspense fallback={null}>
          <Places quality={quality} reduced={reduced} />
        </Suspense>
      ) : null}
    </group>
  );
}
