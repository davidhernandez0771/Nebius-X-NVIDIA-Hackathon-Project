// The results hall: each pre-registered test is a pillar of light whose height is its success rate, inside a glass
// sleeve that spans its Wilson 95% interval, standing under a thin plane of light at the 60% goal. Lit offline: a
// procedural Lightformer environment (no HDR download), contact shadows on a dark floor, bloom on the emissive
// cores, ACES tone mapping at the end. Every number comes in as a prop (model.ts's PILLARS); nothing is typed here.
//
// Cost: the pillars are four instanced meshes (tracks, sleeves, cores, rings), so six pillars or sixty are the
// same draw calls. The canvas renders on demand: the opening camera move and the pillars' rise ask for frames
// until they settle, then a frame is drawn only when something changes. Off-screen or in a hidden tab it stops
// (frameloop "never"). DPR is capped at 1.75. With reduced motion everything starts settled.
import { ContactShadows, Environment, Html, Instance, Instances, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Pillar } from "./model";

/** World units for 100%. */
const H = 4;
const R = { climb: 0.3, scripted: 0.24 };
const SLEEVE = { climb: 0.46, scripted: 0.38 };
const HUE = { climb: new THREE.Color("#19f5c2"), scripted: new THREE.Color("#ffb000") };
const GOAL_HUE = new THREE.Color("#fff3df");
const VOID = "#040607";

const CAM_TO = new THREE.Vector3(2.2, 4.3, 13.4);
const CAM_FROM = new THREE.Vector3(-7, 1.2, 15.5);
const LOOK = new THREE.Vector3(0.2, 1.75, 0);
const CAM_S = 5.2;
const RISE_S = 1.7;
const STAGGER_S = 0.32;

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** Where each pillar stands: the climb left to right, a gap, then the scripted pair a little back. */
export function layout(pillars: Pillar[]): { x: number; z: number }[] {
  let x = -3.7;
  return pillars.map((p, i) => {
    if (i > 0 && p.series !== pillars[i - 1].series) x += 0.45;
    const at = { x, z: p.series === "scripted" ? -0.5 : 0 };
    x += p.series === "climb" ? 1.4 : 1.15;
    return at;
  });
}

type Props = {
  pillars: Pillar[];
  goal: number;
  goalLabel: string;
  selected: number | null;
  onSelect: (i: number) => void;
  animate: boolean;
  active: boolean;
};

function Hall({ pillars, goal, goalLabel, selected, onSelect, animate }: Omit<Props, "active">) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const spots = useMemo(() => layout(pillars), [pillars]);
  const xs = spots.map((s) => s.x);
  const span = [Math.min(...xs) - 0.8, Math.max(...xs) + 0.9] as const;
  const width = span[1] - span[0];
  const mid = (span[0] + span[1]) / 2;

  const cores = useRef<(THREE.Object3D | null)[]>([]);
  const rings = useRef<(THREE.Object3D | null)[]>([]);
  const sleeves = useRef<(THREE.Object3D | null)[]>([]);
  const t = useRef(animate ? 0 : Infinity);
  const done = useRef(false);
  const [settled, setSettled] = useState(!animate);

  const pose = (time: number) => {
    const c = ease(time / CAM_S);
    camera.position.lerpVectors(CAM_FROM, CAM_TO, c);
    camera.lookAt(LOOK);
    pillars.forEach((p, i) => {
      const g = ease((time - 0.6 - i * STAGGER_S) / RISE_S);
      const core = cores.current[i];
      if (core) {
        const h = Math.max(0.02, (p.k / p.n) * H * g);
        core.scale.set(R[p.series], h, R[p.series]);
        core.position.y = h / 2;
      }
      const lit = Math.min(1, Math.max(0, (g - 0.75) / 0.25));
      const sl = sleeves.current[i];
      if (sl) sl.scale.set(SLEEVE[p.series] * (lit || 1e-4), Math.max(0.0001, (p.ci[1] - p.ci[0]) * H), SLEEVE[p.series] * (lit || 1e-4));
      for (const j of [0, 1]) {
        const r = rings.current[2 * i + j];
        if (r) r.scale.setScalar(lit || 1e-4);
      }
    });
  };

  useEffect(() => {
    if (!animate) {
      t.current = Infinity;
      done.current = true;
      setSettled(true);
    }
    pose(t.current);
    invalidate();
    // pose reads refs; the pillars and the motion setting are what change it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, pillars]);

  useFrame((_, dt) => {
    if (done.current) return;
    t.current += Math.min(dt, 1 / 20);
    pose(t.current);
    if (t.current > 0.6 + (pillars.length - 1) * STAGGER_S + RISE_S && !settled) setSettled(true);
    if (t.current > Math.max(CAM_S, 0.6 + (pillars.length - 1) * STAGGER_S + RISE_S)) done.current = true;
    else invalidate();
  });

  const over = (i: number) => (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
    onSelect(i);
  };
  const out = () => {
    document.body.style.cursor = "";
  };

  const tint = (p: Pillar, i: number, k: number) => HUE[p.series].clone().multiplyScalar(selected === i ? k * 1.25 : k);

  return (
    <>
      <color attach="background" args={[VOID]} />
      <fog attach="fog" args={[VOID, 13, 30]} />
      <ambientLight intensity={0.08} />
      <directionalLight position={[4, 9, 6]} intensity={0.5} />

      {/* The light the glass and the floor reflect: built here, offline. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} color="#e9fffa" position={[0, 7, 1]} rotation-x={Math.PI / 2} scale={[12, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#19f5c2" position={[-9, 3, 2]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#ffb000" position={[9, 2.5, -1]} rotation-y={-Math.PI / 2} scale={[6, 0.8, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, 3, 10]} scale={3} />
      </Environment>

      {/* The floor: dark, a little metallic, so the cores pool light in it. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#070b0c" roughness={0.42} metalness={0.55} />
      </mesh>
      <ContactShadows position={[0, 0.002, 0]} scale={18} blur={2.6} far={4.5} opacity={0.75} resolution={512} color="#000000" frames={animate ? Infinity : 1} />

      {/* Plinths. */}
      <Instances limit={pillars.length} range={pillars.length}>
        <cylinderGeometry args={[0.62, 0.66, 0.08, 48]} />
        <meshStandardMaterial color="#0d1416" roughness={0.3} metalness={0.8} />
        {pillars.map((p, i) => (
          <Instance key={p.key} position={[spots[i].x, 0.04, spots[i].z]} scale={p.series === "climb" ? 1 : 0.82} />
        ))}
      </Instances>

      {/* The tracks: the full 0–100% column, faint, and the pointer's target. */}
      <Instances limit={pillars.length} range={pillars.length}>
        <cylinderGeometry args={[1, 1, 1, 48, 1, true]} />
        <meshStandardMaterial color="#9fd8cc" transparent opacity={0.045} roughness={0.1} depthWrite={false} side={THREE.DoubleSide} />
        {pillars.map((p, i) => (
          <Instance
            key={p.key}
            position={[spots[i].x, H / 2 + 0.08, spots[i].z]}
            scale={[SLEEVE[p.series] * 1.08, H, SLEEVE[p.series] * 1.08]}
            onPointerOver={over(i)}
            onPointerOut={out}
            onClick={over(i)}
          />
        ))}
      </Instances>

      {/* The Wilson sleeves: glass from the interval's low end to its high end. */}
      <Instances limit={pillars.length} range={pillars.length}>
        <cylinderGeometry args={[1, 1, 1, 48]} />
        <meshPhysicalMaterial transparent opacity={0.2} roughness={0.08} metalness={0} clearcoat={1} depthWrite={false} emissive="#0a3b31" emissiveIntensity={0.6} />
        {pillars.map((p, i) => (
          <Instance
            key={p.key}
            ref={(o: THREE.Object3D | null) => (sleeves.current[i] = o)}
            position={[spots[i].x, ((p.ci[0] + p.ci[1]) / 2) * H + 0.08, spots[i].z]}
            scale={[SLEEVE[p.series], (p.ci[1] - p.ci[0]) * H, SLEEVE[p.series]]}
            color={HUE[p.series].clone().lerp(new THREE.Color("#ffffff"), 0.55)}
          />
        ))}
      </Instances>

      {/* The interval's two ends, as bright rings. */}
      <Instances limit={pillars.length * 2} range={pillars.length * 2}>
        <torusGeometry args={[1, 0.022, 10, 72]} />
        <meshBasicMaterial toneMapped={false} />
        {pillars.flatMap((p, i) =>
          p.ci.map((v, j) => (
            <group key={`${p.key}-${j}`} position={[spots[i].x, v * H + 0.08, spots[i].z]} rotation-x={Math.PI / 2} scale={SLEEVE[p.series]}>
              <Instance ref={(o: THREE.Object3D | null) => (rings.current[2 * i + j] = o)} color={tint(p, i, 1.3)} />
            </group>
          )),
        )}
      </Instances>

      {/* The cores: the measured rate, emissive past 1 so the bloom takes them. */}
      <Instances limit={pillars.length} range={pillars.length}>
        <cylinderGeometry args={[1, 1, 1, 48]} />
        <meshBasicMaterial toneMapped={false} />
        {pillars.map((p, i) => (
          <group key={p.key} position={[spots[i].x, 0.08, spots[i].z]}>
            <Instance ref={(o: THREE.Object3D | null) => (cores.current[i] = o)} scale={[R[p.series], 1, R[p.series]]} color={tint(p, i, p.metGoal ? 1.3 : 1.1)} />
          </group>
        ))}
      </Instances>

      {/* The goal: a thin plane of light across the hall, with a bright front edge. */}
      <group position={[mid, goal * H + 0.08, -0.2]}>
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[width, 3.4]} />
          <meshBasicMaterial color={GOAL_HUE} transparent opacity={0.022} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 1.7]}>
          <boxGeometry args={[width, 0.014, 0.014]} />
          <meshBasicMaterial color={GOAL_HUE.clone().multiplyScalar(2.2)} toneMapped={false} />
        </mesh>
        <Html position={[-width / 2 + 0.15, -0.05, 1.7]} className="mx-l3d mx-l3d--goal" zIndexRange={[20, 0]}>
          <span aria-hidden="true">{goalLabel}</span>
        </Html>
      </group>

      {/* The back scale: 25, 50, 75, 100%. */}
      <Instances limit={4} range={4}>
        <boxGeometry args={[width, 0.008, 0.008]} />
        <meshBasicMaterial color="#2c4a44" toneMapped={false} />
        {[0.25, 0.5, 0.75, 1].map((v) => (
          <Instance key={v} position={[mid, v * H + 0.08, -1.9]} />
        ))}
      </Instances>
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <Html key={v} position={[span[0] - 0.1, v * H + 0.08, -1.9]} className="mx-l3d mx-l3d--axis" zIndexRange={[10, 0]}>
          <span aria-hidden="true">{v * 100}%</span>
        </Html>
      ))}

      {/* Each pillar's count over its sleeve. */}
      {settled && pillars.map((p, i) => (
        <Html key={p.key} position={[spots[i].x, p.ci[1] * H + 0.5, spots[i].z]} center className="mx-l3d" zIndexRange={[30, 0]}>
          <span aria-hidden="true" className="mx-l3d__pill" data-series={p.series} data-selected={selected === i ? "true" : undefined}>
            <span className="mx-l3d__tag">{p.tag}</span>
            <span className="mx-l3d__count">
              {p.k}/{p.n}
            </span>
          </span>
        </Html>
      ))}

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={1.15} levels={7} />
        <Vignette offset={0.32} darkness={0.62} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

/** On a wide stage the headline sits at the left, so the hall's picture is slid right of it (the camera's view
 *  offset: the same perspective, framed off-centre). Narrow stages put the headline below and centre the hall. */
function Frame() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (size.width > 900) camera.setViewOffset(size.width, size.height, -size.width * 0.15, 0, size.width, size.height);
    else camera.clearViewOffset();
    invalidate();
  }, [camera, size, invalidate]);
  return null;
}

function Wake({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
}

export default function HallScene({ active, ...hall }: Props) {
  return (
    <Canvas
      className="mx-hall__canvas"
      dpr={[1, 1.75]}
      frameloop={active ? "demand" : "never"}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 30, near: 0.1, far: 80, position: hall.animate ? CAM_FROM.toArray() : CAM_TO.toArray() }}
      onCreated={({ camera }) => camera.lookAt(LOOK)}
      onPointerMissed={() => (document.body.style.cursor = "")}
      aria-hidden="true"
    >
      <Wake active={active} />
      <Frame />
      <Hall {...hall} />
    </Canvas>
  );
}
