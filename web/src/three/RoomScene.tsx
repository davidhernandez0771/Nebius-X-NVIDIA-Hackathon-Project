import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scroll } from "./scrollStore";
import { entryCamera, lerp, reviewState, sampleCamera, sceneParams, seg } from "./sceneMath";
import { LEADERS, anchors, emitSceneFrame } from "./labels";
import {
  POINTS_FRAG,
  POINTS_VERT,
  buildRoom,
  patchSweep,
  type BuiltPart,
} from "./roomModel";
import { isMobile } from "./capability";

const REVIEW_ITEMS = ["mug", "charger", "book"];
const STATE_COLOR = {
  unknown: new THREE.Color("#FF9A2E"),
  organize: new THREE.Color("#35F0D0"),
  trash: new THREE.Color("#FF5A5F"),
};
const AMBER = STATE_COLOR.unknown;
const TEAL = STATE_COLOR.organize;
const DANGER = STATE_COLOR.trash;

interface RoomProps {
  /** landing: driven by scroll, has labels. entry: driven by setChapter(). */
  mode: "landing" | "entry";
  mobile: boolean;
}

function Room({ mode, mobile }: RoomProps) {
  const parts = useMemo<BuiltPart[]>(() => buildRoom(mobile ? 80 : 190), [mobile]);
  const sweep = useMemo(() => ({ value: -1 }), []);
  const pointsMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERT,
        fragmentShader: POINTS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: mobile ? 0.045 : 0.032 },
          uScale: { value: 800 },
          uSweep: sweep,
          uOpacity: { value: 1 },
          uWarm: { value: new THREE.Color("#F4F0EC") },
          uTeal: { value: new THREE.Color("#35F0D0") },
          uAmber: { value: new THREE.Color("#FF9A2E") },
        },
      }),
    [mobile, sweep],
  );

  useMemo(() => {
    for (const p of parts) {
      patchSweep(p.material, sweep, true);
      patchSweep(p.edgeMaterial, sweep, false);
    }
  }, [parts, sweep]);

  useEffect(
    () => () => {
      parts.forEach((p) => {
        p.geometry.dispose();
        p.edges.dispose();
        p.points.dispose();
        p.material.dispose();
        p.edgeMaterial.dispose();
      });
      pointsMat.dispose();
    },
    [parts, pointsMat],
  );

  const groups = useRef<Record<string, THREE.Group | null>>({});
  const room = useRef<THREE.Group>(null);
  const scanPlane = useRef<THREE.Group>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  const dust = useRef<THREE.Points>(null);
  const itemList = useMemo(() => parts.filter((p) => p.def.kind === "item"), [parts]);
  const dustGeo = useMemo(() => {
    const n = mobile ? 250 : 600;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = (Math.random() - 0.5) * 20;
      a[i * 3 + 1] = Math.random() * 9 - 1;
      a[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, [mobile]);

  const tmp = useMemo(
    () => ({ v: new THREE.Vector3(), t: new THREE.Vector3(), color: new THREE.Color() }),
    [],
  );

  useFrame((state, delta) => {
    const { camera, size, clock, gl, scene } = state;
    const cam = camera as THREE.PerspectiveCamera;
    const time = clock.elapsedTime;
    const c = scroll.c;
    const P = sceneParams(c);

    // pointer parallax, smoothed
    const k = 1 - Math.exp(-delta * 4);
    scroll.pointer.x = lerp(scroll.pointer.x, pointerTarget.x, k);
    scroll.pointer.y = lerp(scroll.pointer.y, pointerTarget.y, k);

    // globals
    sweep.value = P.sweep;
    pointsMat.uniforms.uTime.value = time;
    pointsMat.uniforms.uScale.value =
      (size.height * gl.getPixelRatio()) / (2 * Math.tan((cam.fov * Math.PI) / 360));

    // room drift
    if (room.current) {
      room.current.rotation.y = -0.35 + time * 0.05 * (1 - 0.7 * seg(c, 0.8, 2)) + c * 0.1;
    }

    // scan plane
    const scanning = seg(c, 0.55, 1.75);
    if (scanPlane.current && scanMat.current) {
      const on = scanning > 0.001 && scanning < 0.999;
      scanPlane.current.visible = on;
      scanPlane.current.position.y = P.sweep;
      scanMat.current.opacity = 0.07 * Math.sin(Math.PI * scanning);
    }

    // parts
    for (const p of parts) {
      const g = groups.current[p.def.id];
      if (!g) continue;
      const d = p.def;
      if (d.kind === "item" && d.item) {
        const idx = itemList.indexOf(p);
        const n = itemList.length;
        const ti = seg(P.sort * 1.6 - (idx / n) * 0.6, 0, 1);
        const ex = P.explode;
        const { clutter, sorted, clutterRot } = d.item;
        g.position.set(
          lerp(clutter[0], sorted[0], ti) + clutter[0] * 0.3 * ex,
          lerp(clutter[1], sorted[1], ti) + Math.sin(Math.PI * ti) * 0.55 +
            (0.75 + idx * 0.1) * ex + Math.sin(time * 1.4 + idx) * 0.03 * ex,
          lerp(clutter[2], sorted[2], ti) + clutter[2] * 0.3 * ex,
        );
        g.rotation.set(0, lerp(clutterRot[1], 0, ti) + time * 0.25 * ex, lerp(clutterRot[2], 0, ti));

        // provisional (amber) until reviewed, then confirmed (teal)
        const rIdx = REVIEW_ITEMS.indexOf(d.id);
        const target =
          rIdx >= 0 && P.confirm < 0.5 ? STATE_COLOR[reviewState(rIdx, c)] : null;
        if (target) {
          p.material.emissive.lerp(target, 0.18);
        } else {
          tmp.color.copy(AMBER).lerp(TEAL, P.confirm);
          p.material.emissive.lerp(tmp.color, 0.18);
        }
        p.material.emissiveIntensity = 0.2 + 0.4 * seg(c, 3.0, 3.4);
      } else if (d.kind === "lamp") {
        const f = P.lampGone;
        g.visible = f < 0.995;
        g.position.set(
          d.pos[0] + d.explode[0] * P.explode,
          d.pos[1] + d.explode[1] * P.explode - f * 0.6,
          d.pos[2] + d.explode[2] * P.explode,
        );
        g.scale.setScalar(1 - f * 0.35);
        p.material.opacity = 1 - f;
        p.edgeMaterial.opacity = p.edgeBase * (1 - f);
        const hi = seg(c, 5.45, 5.7);
        p.material.emissive.copy(AMBER).lerp(DANGER, hi);
        p.material.emissiveIntensity = 0.18 + 0.5 * hi;
      } else {
        g.position.set(
          d.pos[0] + d.explode[0] * P.explode,
          d.pos[1] + d.explode[1] * P.explode,
          d.pos[2] + d.explode[2] * P.explode,
        );
      }
    }

    // dust
    if (dust.current) {
      dust.current.rotation.y = time * 0.01;
      dust.current.position.y = -c * 0.35;
    }

    // camera rig
    const s = mode === "entry" ? entryCamera(c) : sampleCamera(c);
    const dist = mobile ? 1.7 : 1;
    const px = scroll.pointer.x * 0.35;
    const py = scroll.pointer.y * 0.2;
    tmp.t.set(...s.target);
    cam.position.set(
      s.target[0] + (s.pos[0] - s.target[0]) * dist + px,
      s.target[1] + (s.pos[1] - s.target[1]) * dist + py,
      s.target[2] + (s.pos[2] - s.target[2]) * dist,
    );
    cam.lookAt(tmp.t);
    const side = mode === "entry" || mobile ? 0 : s.side;
    cam.setViewOffset(
      size.width,
      size.height,
      -side * 0.2 * size.width,
      (mobile ? 0.13 + s.lift * 0.5 : mode === "entry" ? 0 : 0.02 + s.lift) * size.height,
      size.width,
      size.height,
    );

    // leader anchors -> screen px
    if (mode === "landing") {
      scene.updateMatrixWorld();
      cam.updateMatrixWorld();
      for (const l of LEADERS) {
        const g = groups.current[l.part];
        if (!g) continue;
        tmp.v.set(...l.local);
        g.localToWorld(tmp.v);
        tmp.v.project(cam);
        anchors[l.id] = {
          x: (tmp.v.x * 0.5 + 0.5) * size.width,
          y: (-tmp.v.y * 0.5 + 0.5) * size.height,
          on: tmp.v.z < 1,
        };
      }
      emitSceneFrame();
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} color="#ffe6d2" />
      <directionalLight position={[5, 7, 4]} intensity={2.2} color="#ffb37a" />
      <directionalLight position={[-5, 3, -2]} intensity={0.9} color="#35F0D0" />
      <pointLight position={[0, 3.2, 0]} intensity={6} distance={9} color="#ff9a2e" />

      <points ref={dust} geometry={dustGeo}>
        <pointsMaterial
          size={0.035}
          color="#F4F0EC"
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <group ref={room}>
        {parts.map((p) => (
          <group key={p.def.id} ref={(g) => (groups.current[p.def.id] = g)}>
            <mesh geometry={p.geometry} material={p.material} renderOrder={p.def.glass ? 2 : 1} />
            <lineSegments geometry={p.edges} material={p.edgeMaterial} renderOrder={3} />
            <points geometry={p.points} material={pointsMat} renderOrder={4} />
          </group>
        ))}
        <group ref={scanPlane} visible={false}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[5.2, 5.2]} />
            <meshBasicMaterial
              ref={scanMat}
              color="#35F0D0"
              transparent
              opacity={0.06}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
          <lineLoop rotation={[-Math.PI / 2, 0, 0]}>
            <bufferGeometry
              attach="geometry"
              onUpdate={(g) =>
                g.setFromPoints([
                  new THREE.Vector3(-2.6, -2.6, 0),
                  new THREE.Vector3(2.6, -2.6, 0),
                  new THREE.Vector3(2.6, 2.6, 0),
                  new THREE.Vector3(-2.6, 2.6, 0),
                ])
              }
            />
            <lineBasicMaterial color="#35F0D0" transparent opacity={0.55} depthWrite={false} />
          </lineLoop>
        </group>
      </group>
    </>
  );
}

const pointerTarget = { x: 0, y: 0 };

export default function RoomScene({ mode }: { mode: "landing" | "entry" }) {
  const mobile = useMemo(() => isMobile(), []);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <Canvas
      className="room-canvas"
      dpr={[1, mobile ? 1.5 : 2]}
      camera={{ fov: 34, near: 0.1, far: 60, position: [6, 4, 7] }}
      gl={{ antialias: !mobile, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <Room mode={mode} mobile={mobile} />
    </Canvas>
  );
}
