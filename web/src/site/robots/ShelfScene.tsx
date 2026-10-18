// The 3D shelf: a loose, collision-free spiral of glossy grayscale cartridges (spiral.ts), a slow spin, pointer
// parallax, and a picked robot that slides out while the pile parts around it. Post: bloom, then a grade pass
// (ACES, grayscale, vignette, grain, dim on select) after the prototype's look.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  FogExp2,
  Group,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  NoToneMapping,
  PlaneGeometry,
  PMREMGenerator,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type PointLight,
  type SpotLight,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { cartridgePose, layoutSpiral, pileOffset, MAIN_SLOTS, BOB, type SpiralItem } from "./spiral";
import { COPIES, ROBOTS } from "./robots";
import { labelTexture } from "./labels";
import type { Hud } from "./hud";

/** Shared, mutable view state the page writes and the frame loop reads (no re-render per frame). */
export type ShelfView = {
  selected: number | null;
  reduce: boolean;
  /** Pointer in -1..1 across the stage. */
  ptr: Vector2;
  /** Scroll position through the pile, 0..1. */
  scrollT: number;
};

// Lighting, after the reference: thin edge highlights and small glints, never blown-out faces.
const LIGHT = { exposure: 1.0, ambient: 0.06, key: 30, rim: 2.5, glint: 12, glint2: 8, env: 0.2 };
// Phones see the pile closer (wider lens), so a glint covers more of the frame: bloom less there.
const BLOOM = { strength: 0.6, narrowStrength: 0.3, radius: 0.2, threshold: 1.6, clamp: 2.2 };

/** The prototype ran without colour management, so its hex values were linear; keep that response. */
const lin = (hex: string) => new Color().setHex(parseInt(hex.slice(1), 16), LinearSRGBColorSpace);

/** Caps HDR before bloom: a grazing clearcoat glint stays a small orb instead of washing the frame white. */
const CLAMP = {
  uniforms: { tDiffuse: { value: null }, cap: { value: BLOOM.clamp } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform sampler2D tDiffuse; uniform float cap; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(clamp(c, 0.0, cap), 1.0); }",
};

const GRADE = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, dim: { value: 1 }, exposure: { value: LIGHT.exposure } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: [
    "uniform sampler2D tDiffuse; uniform float time; uniform float dim; uniform float exposure; varying vec2 vUv;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }",
    "vec3 aces(vec3 c){",
    "  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));",
    "  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));",
    "  return clamp(O * fit(I * (c * exposure / 0.6)), 0.0, 1.0);",
    "}",
    "void main(){",
    "  vec3 c = aces(texture2D(tDiffuse, vUv).rgb);",
    "  float l = dot(c, vec3(.299, .587, .114));",
    "  l = pow(smoothstep(.015, 1.0, l), .92);",
    "  float v = smoothstep(1.15, .35, length(vUv - .5) * 1.3);",
    "  l *= mix(.55, 1.0, v) * dim;",
    "  l += (hash(vUv * 1000.0 + time) - .5) * .035;",
    "  gl_FragColor = vec4(vec3(l), 1.0);",
    "}",
  ].join("\n"),
};

const FACE = -Math.atan2(4.4, 5.6) + 0.3;

function useCartridgeKit() {
  return useMemo(() => {
    const plastic = new MeshPhysicalMaterial({ color: lin("#1c1c1c"), roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
    const clear = new MeshPhysicalMaterial({ color: lin("#9a9a9a"), roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.28, envMapIntensity: 1.6 });
    return {
      plastic,
      clear,
      // Slightly rounded shells so the edges catch thin highlights.
      body: new RoundedBoxGeometry(2.3, 2.5, 0.34, 2, 0.035),
      step: new RoundedBoxGeometry(2.3, 0.55, 0.26, 2, 0.03),
      rib: new BoxGeometry(2.0, 0.045, 0.09),
      win: new BoxGeometry(1.5, 0.28, 0.36),
      label: new PlaneGeometry(1.86, 1.49),
      under: new PlaneGeometry(1.5, 0.9),
    };
  }, []);
}

type Kit = ReturnType<typeof useCartridgeKit>;

function Cartridge({ item, kit, groupRef, onPick, onHover }: { item: SpiralItem; kit: Kit; groupRef: (g: Group | null) => void; onPick: (ri: number) => void; onHover: (on: boolean) => void }) {
  const robot = item.ri >= 0 ? ROBOTS[item.ri] : ROBOTS[item.k % 3];
  const mats = useMemo(() => {
    const map = labelTexture(robot, item.copyN, COPIES.total);
    // Labels sit a little under paper-white so the key light reads as a sheen, not a blown-out face.
    return {
      front: new MeshPhysicalMaterial({ map, color: lin("#d8d8d4"), roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.5 }),
      back: new MeshPhysicalMaterial({ map, roughness: 0.5, color: lin("#8a8a86") }),
    };
  }, [robot, item.copyN]);
  useEffect(() => () => { mats.front.map?.dispose(); mats.front.dispose(); mats.back.dispose(); }, [mats]);

  const main = item.ri >= 0;
  const pose = cartridgePose(item.base);
  return (
    <group position={[0, item.pivotY, 0]} rotation={[0, item.pivotRot, 0]} name={`pivot-${item.k}`}>
      <group ref={groupRef} position={pose.position} rotation={pose.rotation}>
        <mesh
          geometry={kit.body}
          material={kit.plastic}
          onClick={main ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(item.ri); } : undefined}
          onPointerOver={main ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(true); } : undefined}
          onPointerOut={main ? () => onHover(false) : undefined}
        />
        <mesh geometry={kit.step} material={kit.plastic} position={[0, 1.5, -0.04]} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} geometry={kit.rib} material={kit.plastic} position={[0, 1.32 + i * 0.07, 0.1]} />
        ))}
        <mesh geometry={kit.win} material={kit.clear} position={[0, -1.02, 0]} />
        <mesh geometry={kit.label} material={mats.front} position={[0, -0.12, 0.171]} />
        <mesh geometry={kit.under} material={mats.back} position={[0, -0.2, -0.171]} rotation={[0, Math.PI, 0]} />
      </group>
    </group>
  );
}

function Shelf({ view, hud, onPick, onHover }: { view: MutableRefObject<ShelfView>; hud: MutableRefObject<Hud | null>; onPick: (ri: number) => void; onHover: (on: boolean) => void }) {
  const { gl, scene, camera, size } = useThree();
  const kit = useCartridgeKit();
  const { items, pileTop } = useMemo(() => layoutSpiral(), []);
  const spiral = useRef<Group>(null);
  const groups = useRef<(Group | null)[]>([]);
  const key = useRef<SpotLight>(null);
  const glint = useRef<PointLight>(null);
  const glint2 = useRef<PointLight>(null);
  const anim = useRef({ spin: 0, scroll: 0.5, dim: 1, ptr: new Vector2(), outs: MAIN_SLOTS.map(() => 0) });

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
    try {
      const composer = new EffectComposer(gl);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new ShaderPass(CLAMP));
      const bloom = new UnrealBloomPass(new Vector2(512, 512), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      composer.addPass(bloom);
      const grade = new ShaderPass(GRADE);
      composer.addPass(grade);
      return { composer, bloom, grade, env };
    } catch {
      gl.toneMapping = ACESFilmicToneMapping; // when the composer can't start
      return { composer: null, bloom: null, grade: null, env };
    }
  }, [gl, scene, camera]);
  useEffect(() => () => { post.composer?.dispose(); post.env.dispose(); }, [post]);

  useEffect(() => {
    post.composer?.setSize(size.width, size.height);
    const narrow = size.width < 640;
    if (post.bloom) post.bloom.strength = narrow ? BLOOM.narrowStrength : BLOOM.strength;
    const cam = camera as PerspectiveCamera;
    cam.fov = narrow ? 54 : 36;
    cam.updateProjectionMatrix();
  }, [post, size, camera]);

  const tmp = useMemo(() => new Vector3(), []);
  useFrame((state, delta) => {
    const v = view.current, a = anim.current, reduce = v.reduce;
    const dt = Math.min(delta, 0.05), t = state.clock.elapsedTime, k = reduce ? 1 : 1 - Math.pow(0.003, dt);
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

    MAIN_SLOTS.forEach((_, ri) => { a.outs[ri] += ((ri === v.selected ? 1 : 0) - a.outs[ri]) * k; });
    items.forEach((it) => {
      const g = groups.current[it.k];
      if (!g || !g.parent) return;
      g.parent.position.y = it.pivotY + pileOffset(it.k, a.outs);
      const out = it.ri >= 0 ? a.outs[it.ri] : 0;
      const pose = cartridgePose(it.base, out, reduce ? 0 : Math.sin(t * 0.55 + it.phase) * BOB);
      g.position.set(...pose.position);
      g.rotation.set(...pose.rotation);
    });

    a.dim += ((v.selected == null ? 1 : 0.5) - a.dim) * k;
    if (post.grade) { post.grade.uniforms.time.value = t; post.grade.uniforms.dim.value = a.dim; }
    if (post.composer) post.composer.render(dt);
    else gl.render(scene, camera);

    const h = hud.current;
    if (!h) return;
    if (v.selected == null) { h.clear(); return; }
    const g = groups.current[MAIN_SLOTS[v.selected]];
    if (!g) return;
    g.getWorldPosition(tmp).project(camera);
    h.draw((tmp.x * 0.5 + 0.5) * size.width, (-tmp.y * 0.5 + 0.5) * size.height, t, performance.now());
  }, 1);

  return (
    <>
      <ambientLight intensity={LIGHT.ambient} />
      <spotLight ref={key} intensity={LIGHT.key} distance={18} angle={0.62} penumbra={0.7} decay={1.4} />
      <directionalLight intensity={LIGHT.rim} position={[-6, 5, -6]} />
      <pointLight ref={glint} intensity={LIGHT.glint} distance={5} decay={2} />
      <pointLight ref={glint2} intensity={LIGHT.glint2} distance={4} decay={2} />
      <group ref={spiral}>
        {items.map((it) => (
          <Cartridge key={it.k} item={it} kit={kit} groupRef={(g) => { groups.current[it.k] = g; }} onPick={onPick} onHover={onHover} />
        ))}
      </group>
    </>
  );
}

export default function ShelfScene({ view, hud, onPick, onMiss, onHover }: { view: MutableRefObject<ShelfView>; hud: MutableRefObject<Hud | null>; onPick: (ri: number) => void; onMiss: () => void; onHover: (on: boolean) => void }) {
  return (
    <Canvas
      className="robots-canvas"
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      camera={{ fov: 36, near: 0.1, far: 60, position: [5.6, 4.6, 4.4] }}
      onPointerMissed={onMiss}
      aria-label="A loose spiral of robot cartridges. Pick one from the list or click it."
    >
      <Shelf view={view} hud={hud} onPick={onPick} onHover={onHover} />
    </Canvas>
  );
}
