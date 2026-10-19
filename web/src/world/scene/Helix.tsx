// The spiral shelf's 29 cartridges: one InstancedMesh per part of cartridge.glb (8 draw calls for all
// of them), placed from layout.json, each label reading its robot's tile of the atlas and each shell
// its tint. Pointing at one lifts it out of its slot; clicking sends it to the machine. Hits go to a
// box per cartridge (12 triangles) instead of the 2,000-triangle shells.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { QualityTier } from "../core/quality";
import { CARTRIDGE_URL } from "./assets";
import { cartridgeParts, labelAtlas, offRedraw, slotMatrix, tileAttribute } from "./cartridge";
import { HELIX } from "./layout";
import { liveMaterial, trackLive, withTiles } from "./materials";
import { plug } from "./plug";
import { markLoaded } from "./power";
import { ROBOTS } from "./robots";

/** Graphite, the default shell: glossy near-black plastic (linear RGB). */
export const GRAPHITE = [0.032, 0.033, 0.036] as const;
/** How far a pointed-at cartridge slides out of its slot, and up, in metres. */
const LIFT_OUT = 0.5;
const LIFT_UP = 0.12;
const LIFT_RATE = 14;

const N = HELIX.length;
const BASE = HELIX.map((s) => slotMatrix(s));
/** Each slot's outward direction (its face normal), for the lift. */
const OUT = HELIX.map((s) => new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...s.quaternion)));
const TILES = HELIX.map((s) => ROBOTS.findIndex((r) => r.code === s.code));
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function Helix({ quality, active, onSend }: { quality: QualityTier; active: () => boolean; onSend: (slot: number) => void }) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  const invalidate = useThree((s) => s.invalidate);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lift = useRef(new Float32Array(N));
  const hovered = useRef<number | null>(null);
  const shown = useRef<number | null>(null);

  const parts = useMemo(() => {
    const atlas = labelAtlas();
    return cartridgeParts(gltf.scene).map((p) => {
      const isLabel = p.name.startsWith("label");
      const isShell = p.name.startsWith("shell");
      const isWindow = p.name.startsWith("window");
      const geometry = isLabel ? p.geometry.clone() : p.geometry;
      if (isLabel) geometry.setAttribute("aTile", tileAttribute(TILES));
      const material = isLabel
        ? withTiles(liveMaterial(p.source, quality, { map: atlas, color: "#ffffff" }))
        : liveMaterial(p.source, quality, isShell ? { color: "#ffffff" } : isWindow ? { transparent: true, opacity: 0.35 } : {});
      return { name: p.name, geometry, material, isShell };
    });
  }, [gltf, quality]);

  const proxy = useMemo(() => new THREE.BoxGeometry(2.3, 2.5, 0.4), []);
  const proxyMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);

  useEffect(() => {
    const releases = parts.map((p) => trackLive(p.material));
    const redraw = () => invalidate();
    labelAtlas(redraw);
    markLoaded(CARTRIDGE_URL);
    return () => {
      releases.forEach((r) => r());
      offRedraw(redraw);
    };
  }, [parts, invalidate]);

  // Place every instance, tint the shells, and size the culling spheres once.
  useEffect(() => {
    const c = new THREE.Color();
    meshes.current.forEach((m, k) => {
      if (!m) return;
      for (let i = 0; i < N; i++) m.setMatrixAt(i, BASE[i]);
      if (parts[k]?.isShell) {
        HELIX.forEach((s, i) => m.setColorAt(i, c.setRGB(...(s.shell ?? GRAPHITE), THREE.LinearSRGBColorSpace)));
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    });
    invalidate();
  }, [parts, invalidate]);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  // Reused every frame, so the idle loops allocate nothing.
  const dirty = useMemo(() => new Uint8Array(N), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const away = plug.progress > 0 ? plug.slot : null;
    let moving = false;
    let any = false;
    dirty.fill(0);
    for (let i = 0; i < N; i++) {
      const target = hovered.current === i && away !== i ? 1 : 0;
      const l = lift.current[i];
      if (l === target) continue;
      let next = l + (target - l) * (1 - Math.exp(-LIFT_RATE * dt));
      if (Math.abs(next - target) < 0.002) next = target;
      else moving = true;
      lift.current[i] = next;
      dirty[i] = 1;
      any = true;
    }
    if (away !== shown.current) {
      if (shown.current !== null) dirty[shown.current] = 1;
      if (away !== null) dirty[away] = 1;
      shown.current = away;
      any = true;
    }
    if (!any) return;
    for (let i = 0; i < N; i++) {
      if (!dirty[i]) continue;
      let mat: THREE.Matrix4;
      if (i === away) mat = HIDDEN;
      else {
        const l = lift.current[i];
        const o = OUT[i];
        mat = m4.copy(BASE[i]);
        mat.elements[12] += o.x * LIFT_OUT * l;
        mat.elements[13] += o.y * LIFT_OUT * l + LIFT_UP * l;
        mat.elements[14] += o.z * LIFT_OUT * l;
      }
      meshes.current.forEach((m) => m?.setMatrixAt(i, mat));
    }
    meshes.current.forEach((m) => m && (m.instanceMatrix.needsUpdate = true));
    if (moving) invalidate();
  });

  const point = (e: ThreeEvent<PointerEvent>) => {
    const i = e.instanceId ?? null;
    if (!active() || i === null) return leave();
    e.stopPropagation();
    if (hovered.current !== i) {
      hovered.current = i;
      document.body.style.cursor = "pointer";
      invalidate();
    }
  };
  const leave = () => {
    if (hovered.current === null) return;
    hovered.current = null;
    document.body.style.cursor = "";
    invalidate();
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!active() || e.instanceId === undefined) return;
    e.stopPropagation();
    onSend(e.instanceId);
  };
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <group name="helix">
      {parts.map((p, k) => (
        <instancedMesh key={p.name} ref={(m) => (meshes.current[k] = m)} args={[p.geometry, p.material, N]} raycast={() => null} name={`helix:${p.name}`} />
      ))}
      <instancedMesh
        ref={(m) => {
          if (!m) return;
          for (let i = 0; i < N; i++) m.setMatrixAt(i, BASE[i]);
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
        }}
        args={[proxy, proxyMat, N]}
        onPointerMove={point}
        onPointerOut={leave}
        onClick={click}
        name="helix:hits"
      />
    </group>
  );
}
