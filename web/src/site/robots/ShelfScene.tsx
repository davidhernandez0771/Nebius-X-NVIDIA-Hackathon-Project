// The 3D shelf: a loose, collision-free spiral of glossy grayscale cartridges (spiral.ts), a slow spin, pointer
// parallax, and a picked robot that slides out while the pile parts around it. Post: bloom, then a grade pass
// (ACES, grayscale, vignette, grain, dim on select) after the prototype's look.
//
// Built for a shared GPU: every cartridge part is one instanced mesh (4 draw calls for all 30 cartridges), the
// labels share one atlas texture, the frame loop allocates nothing, the post chain holds one half-float target
// (post.ts), and quality tiers (quality.ts) drop the DPR and bloom when fps falls.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  FogExp2,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearSRGBColorSpace,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoToneMapping,
  PlaneGeometry,
  PMREMGenerator,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type PerspectiveCamera,
  type PointLight,
  type SpotLight,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { compileSafe } from "../../three/compileSafe";
import { BOB, composeCartridgeMatrix, layoutSpiral, MAIN_SLOTS, N, pileOffset, type SpiralItem } from "./spiral";
import { COPIES, ROBOTS } from "./robots";
import { drawLabel } from "./labels";
import { atlasLayout, atlasUv } from "./atlas";
import { ShelfPost } from "./post";
import { floorTier, nextTier, tierSettings } from "./quality";
import type { Hud } from "./hud";
import type { PerfProbe } from "./perf";

/** Shared, mutable view state the page writes and the frame loop reads (no re-render per frame). */
export type ShelfView = {
  selected: number | null;
  reduce: boolean;
  /** Pointer in -1..1 across the stage. */
  ptr: Vector2;
  /** Scroll position through the pile, 0..1. */
  scrollT: number;
  /** Wheel / touch scroll gathered since the last frame (applied once per frame). */
  wheel: number;
};

// Lighting, after the reference: thin edge highlights and small glints, never blown-out faces.
const LIGHT = { exposure: 1.0, ambient: 0.06, key: 30, rim: 2.5, glint: 12, glint2: 8, env: 0.2 };
// Phones see the pile closer (wider lens), so a glint covers more of the frame: bloom less there.
const BLOOM = { strength: 0.6, narrowStrength: 0.3, radius: 0.2, threshold: 1.6, cap: 2.2 };
const SCROLL_PER_WHEEL = 0.0006;
const FACE = -Math.atan2(4.4, 5.6) + 0.3;
// Label atlas cells: the prototype's 640 × 512 label drawn at 0.7.
const LABEL = { w: 640, h: 512, cellW: 448, cellH: 358, pad: 8, maxWidth: 2400 };

/** The prototype ran without colour management, so its hex values were linear; keep that response. */
const lin = (hex: string) => new Color().setHex(parseInt(hex.slice(1), 16), LinearSRGBColorSpace);

/** Reads each instance's atlas cell (attribute atlasRect = u0, v0, su, sv) for the label map. */
function withAtlasUv(m: MeshPhysicalMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nattribute vec4 atlasRect;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = atlasRect.xy + vMapUv * atlasRect.zw;\n#endif");
  };
  m.customProgramCacheKey = () => "sant-label-atlas";
  return m;
}

function buildKit(items: SpiralItem[]) {
  // One merged shell per cartridge: rounded body (so edges catch thin highlights), ribbed step and six ribs.
  const parts: BufferGeometry[] = [new RoundedBoxGeometry(2.3, 2.5, 0.34, 2, 0.035), new RoundedBoxGeometry(2.3, 0.55, 0.26, 2, 0.03).translate(0, 1.5, -0.04)];
  for (let i = 0; i < 6; i++) parts.push(new BoxGeometry(2.0, 0.045, 0.09).translate(0, 1.32 + i * 0.07, 0.1));
  // RoundedBoxGeometry is non-indexed and BoxGeometry indexed; merging needs them all alike.
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const shell = mergeGeometries(flat);
  if (!shell) throw new Error("robots: could not merge the cartridge shell geometry");
  new Set([...parts, ...flat]).forEach((p) => p.dispose());
  const win = new BoxGeometry(1.5, 0.28, 0.36).translate(0, -1.02, 0);
  const front = new PlaneGeometry(1.86, 1.49).translate(0, -0.12, 0.171);
  const back = new PlaneGeometry(1.5, 0.9).rotateY(Math.PI).translate(0, -0.2, -0.171);
  const hit = new BoxGeometry(2.3, 3.05, 0.36).translate(0, 0.2625, 0);

  // Every label in one atlas.
  const L = atlasLayout(items.length, LABEL.cellW, LABEL.cellH, LABEL.pad, LABEL.maxWidth);
  const canvas = document.createElement("canvas");
  canvas.width = L.width;
  canvas.height = L.height;
  const g = canvas.getContext("2d");
  const rects = new Float32Array(items.length * 4);
  items.forEach((it, k) => {
    const r = L.rects[k];
    if (g) {
      g.save();
      g.translate(r.x, r.y);
      g.scale(LABEL.cellW / LABEL.w, LABEL.cellH / LABEL.h);
      drawLabel(g, LABEL.w, LABEL.h, it.ri >= 0 ? ROBOTS[it.ri] : ROBOTS[it.k % 3], it.copyN, COPIES.total);
      g.restore();
    }
    rects.set(atlasUv(r, L.width, L.height), k * 4);
  });
  const atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 8;
  front.setAttribute("atlasRect", new InstancedBufferAttribute(rects, 4));
  back.setAttribute("atlasRect", new InstancedBufferAttribute(rects, 4));

  const mats = {
    plastic: new MeshPhysicalMaterial({ color: lin("#1c1c1c"), roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }),
    clear: new MeshPhysicalMaterial({ color: lin("#9a9a9a"), roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.28, envMapIntensity: 1.6 }),
    // Labels sit a little under paper-white so the key light reads as a sheen, not a blown-out face.
    front: withAtlasUv(new MeshPhysicalMaterial({ map: atlas, color: lin("#d8d8d4"), roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.5 })),
    back: withAtlasUv(new MeshPhysicalMaterial({ map: atlas, roughness: 0.5, color: lin("#8a8a86") })),
    hit: new MeshBasicMaterial({ visible: false }), // picking only, never drawn
  };
  return { geo: { shell, win, front, back, hit }, mats, atlas, atlasBytes: L.width * L.height * 4 * 1.33 };
}

type ShelfProps = {
  view: MutableRefObject<ShelfView>;
  hud: MutableRefObject<Hud | null>;
  onPick: (ri: number) => void;
  onHover: (on: boolean) => void;
  perf?: PerfProbe | null;
  bloomScale: number;
};

function Shelf({ view, hud, onPick, onHover, perf, bloomScale }: ShelfProps) {
  const { gl, scene, camera, size, viewport } = useThree();
  const { items, pileTop } = useMemo(() => layoutSpiral(), []);
  const kit = useMemo(() => buildKit(items), [items]);
  const spiral = useRef<Group>(null);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const hitMesh = useRef<InstancedMesh>(null);
  const key = useRef<SpotLight>(null);
  const glint = useRef<PointLight>(null);
  const glint2 = useRef<PointLight>(null);
  const anim = useRef({ spin: 0, scroll: 0.5, dim: 1, ptr: new Vector2(), outs: MAIN_SLOTS.map(() => 0), ready: false });
  const scratch = useMemo(() => ({ m: new Matrix4(), v: new Vector3(), px: new Uint8Array(4) }), []);

  useEffect(() => () => {
    Object.values(kit.geo).forEach((g) => g.dispose());
    Object.values(kit.mats).forEach((m) => m.dispose());
    kit.atlas.dispose();
  }, [kit]);

  // Environment, fog and the post chain.
  const post = useMemo(() => {
    gl.toneMapping = NoToneMapping; // tone mapping happens in the grade pass, after bloom
    gl.outputColorSpace = LinearSRGBColorSpace;
    scene.background = new Color("#000");
    scene.fog = new FogExp2("#000", 0.085);
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = LIGHT.env;
    return { chain: new ShelfPost(gl, { strength: BLOOM.strength, radius: BLOOM.radius, threshold: BLOOM.threshold, cap: BLOOM.cap }, LIGHT.exposure), env };
  }, [gl, scene]);
  useEffect(() => () => { post.chain.dispose(); post.env.dispose(); }, [post]);

  useEffect(() => {
    const narrow = size.width < 640;
    post.chain.setSize(size.width * viewport.dpr, size.height * viewport.dpr, bloomScale);
    post.chain.setStrength(narrow ? BLOOM.narrowStrength : BLOOM.strength);
    const cam = camera as PerspectiveCamera;
    cam.fov = narrow ? 54 : 36;
    cam.updateProjectionMatrix();
  }, [post, size, viewport.dpr, camera, bloomScale]);

  // Compile every shader before the first frame without blocking the page (parallel compile where supported).
  // compileSafe: three's compileAsync throws from a timer if a material is disposed while it waits.
  useEffect(() => {
    let live = true;
    const done = () => { if (live) anim.current.ready = true; };
    compileSafe(gl, scene, camera).then(done, done);
    const t = window.setTimeout(done, 1500);
    return () => { live = false; window.clearTimeout(t); };
  }, [gl, scene, camera]);

  useEffect(() => {
    if (!perf) return;
    gl.info.autoReset = false; // the post chain renders several passes; count them all per frame
    const id = window.setInterval(() => {
      const c = gl.domElement;
      perf.meta.canvas = `${c.width}x${c.height}`;
      perf.meta.dpr = Math.round(gl.getPixelRatio() * 100) / 100;
      perf.meta.bloom = bloomScale;
      perf.meta.gpuMBest = Math.round((post.chain.bytes() + kit.atlasBytes + c.width * c.height * 4) / 1e6);
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) perf.meta.heapMB = Math.round(mem.usedJSHeapSize / 1e6);
    }, 500);
    return () => { window.clearInterval(id); gl.info.autoReset = true; };
  }, [perf, gl, post, kit, bloomScale]);

  useFrame((state, delta) => {
    const a = anim.current;
    if (!a.ready) return;
    const t0 = perf ? performance.now() : 0;
    if (perf) gl.info.reset();
    const v = view.current, reduce = v.reduce;
    const dt = Math.min(delta, 0.05), t = state.clock.elapsedTime, k = reduce ? 1 : 1 - Math.pow(0.003, dt);
    if (v.wheel !== 0) {
      v.scrollT = Math.min(1, Math.max(0, v.scrollT + v.wheel * SCROLL_PER_WHEEL));
      v.wheel = 0;
    }
    a.ptr.lerp(v.ptr, reduce ? 1 : 0.04);
    if (v.selected == null) {
      if (!reduce) a.spin += dt * 0.06;
    } else {
      const sel = items[MAIN_SLOTS[v.selected]];
      const target = FACE - sel.pivotRot;
      a.spin += Math.atan2(Math.sin(target - a.spin), Math.cos(target - a.spin)) * k;
      v.scrollT = Math.min(1, Math.max(0, (sel.pivotY - 2) / (pileTop - 4)));
    }
    a.scroll += (v.scrollT - a.scroll) * (reduce ? 1 : 0.06);
    if (spiral.current) spiral.current.rotation.y = a.spin;
    const midY = 2 + a.scroll * (pileTop - 4);
    camera.position.set(5.6 + a.ptr.x * 0.6, midY + 2.6 - a.ptr.y * 0.4, 4.4);
    camera.lookAt(0, midY - 0.1, 0);
    key.current?.position.set(2.4, midY + 6.5, 3.4);
    key.current?.target.position.set(0.4, midY, 0);
    key.current?.target.updateMatrixWorld();
    glint.current?.position.set(2.8, midY + 0.5 + Math.sin(t * 0.6) * 1.8, 2.2);
    glint2.current?.position.set(-2.2 + Math.sin(t * 0.45) * 0.8, midY + 1 + Math.cos(t * 0.4) * 1.4, 2.6);

    for (let ri = 0; ri < MAIN_SLOTS.length; ri++) a.outs[ri] += ((ri === v.selected ? 1 : 0) - a.outs[ri]) * k;
    const ms = meshes.current, m = scratch.m;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const out = it.ri >= 0 ? a.outs[it.ri] : 0;
      composeCartridgeMatrix(m, it, out, reduce ? 0 : Math.sin(t * 0.55 + it.phase) * BOB, pileOffset(it.k, a.outs));
      for (let j = 0; j < ms.length; j++) ms[j]?.setMatrixAt(i, m);
      if (it.ri >= 0) hitMesh.current?.setMatrixAt(it.ri, m);
    }
    for (let j = 0; j < ms.length; j++) if (ms[j]) ms[j]!.instanceMatrix.needsUpdate = true;
    if (hitMesh.current) {
      hitMesh.current.instanceMatrix.needsUpdate = true;
      hitMesh.current.computeBoundingSphere(); // keep picking right as the robots slide
    }

    a.dim += ((v.selected == null ? 1 : 0.5) - a.dim) * k;
    post.chain.render(scene, camera, dt, t, a.dim);
    if (perf?.meta.sync) { const c = gl.getContext(); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, scratch.px); }

    const h = hud.current;
    if (h) {
      if (v.selected == null) h.clear();
      else if (spiral.current && ms[0]) {
        ms[0].getMatrixAt(MAIN_SLOTS[v.selected], m);
        scratch.v.setFromMatrixPosition(m).applyMatrix4(spiral.current.matrixWorld).project(camera);
        h.draw((scratch.v.x * 0.5 + 0.5) * size.width, (-scratch.v.y * 0.5 + 0.5) * size.height, t, performance.now());
      }
    }
    if (perf) perf.frame({ now: t0, cpuMs: performance.now() - t0, info: gl.info, scroll: a.scroll, selected: v.selected });
  }, 1);

  const pickAt = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return;
    e.stopPropagation();
    onPick(e.instanceId);
  };

  return (
    <>
      <ambientLight intensity={LIGHT.ambient} />
      <spotLight ref={key} intensity={LIGHT.key} distance={18} angle={0.62} penumbra={0.7} decay={1.4} />
      <directionalLight intensity={LIGHT.rim} position={[-6, 5, -6]} />
      <pointLight ref={glint} intensity={LIGHT.glint} distance={5} decay={2} />
      <pointLight ref={glint2} intensity={LIGHT.glint2} distance={4} decay={2} />
      <group ref={spiral}>
        {(["shell", "win", "front", "back"] as const).map((part, j) => (
          <instancedMesh
            key={part}
            ref={(el) => { meshes.current[j] = el; }}
            args={[kit.geo[part], part === "shell" ? kit.mats.plastic : part === "win" ? kit.mats.clear : kit.mats[part], N]}
            frustumCulled={false}
          />
        ))}
        <instancedMesh
          ref={hitMesh}
          args={[kit.geo.hit, kit.mats.hit, MAIN_SLOTS.length]}
          frustumCulled={false}
          onClick={pickAt}
          onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
          onPointerOut={() => onHover(false)}
        />
      </group>
    </>
  );
}

export default function ShelfScene({ onMiss, dpr, tier: tierOverride, active = true, ...shelf }: Omit<ShelfProps, "bloomScale"> & { onMiss: () => void; dpr?: number | null; tier?: number | null; active?: boolean }) {
  const deviceDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const [floor, setFloor] = useState(0);
  const [tier, setTier] = useState(0);
  const t = tierOverride ?? Math.max(tier, floor);
  const s = tierSettings(t, deviceDpr);
  const adaptive = tierOverride == null && dpr == null;
  useEffect(() => {
    if (shelf.perf) shelf.perf.meta.tier = t;
  }, [shelf.perf, t]);
  return (
    <Canvas
      className="robots-canvas"
      dpr={dpr ?? s.dpr}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "high-performance" }}
      camera={{ fov: 36, near: 0.1, far: 60, position: [5.6, 4.6, 4.4] }}
      onCreated={({ gl }) => {
        const c = gl.getContext();
        const ext = c.getExtension("WEBGL_debug_renderer_info");
        const name = ext ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
        setFloor(floorTier(name));
      }}
      onPointerMissed={onMiss}
      aria-label="A loose spiral of robot cartridges. Pick one from the list or click it."
    >
      {adaptive && (
        <PerformanceMonitor
          onDecline={() => setTier((x) => nextTier(Math.max(x, floor), "decline", floor))}
          onIncline={() => setTier((x) => nextTier(Math.max(x, floor), "incline", floor))}
        />
      )}
      <Shelf {...shelf} bloomScale={s.bloom} />
    </Canvas>
  );
}
