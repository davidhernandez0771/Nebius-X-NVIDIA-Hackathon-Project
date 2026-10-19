// The spiral shelf's 29 cartridges: one InstancedMesh per part of cartridge.glb (8 draw calls for all
// of them), each label reading its tile of the atlas and each shell its tint. The 24 jobs (items.ts)
// fill the top slots and slide along the helix when a filter reorders them (spiral.ts); the five robot
// cartridges keep the lowest slots. The front cartridge (the scroll's step) stands out of its slot,
// the pointed-at one lifts further, the one open in the detail view comes right out, and with a
// filter on the others dim. Hits go to a box per cartridge (12 triangles) instead of the shells.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { QualityTier } from "../core/quality";
import { CARTRIDGE_URL } from "./assets";
import { cartridgeParts, labelAtlas, offRedraw, slotMatrix, tileAttribute } from "./cartridge";
import { ITEM_TILE0 } from "./labels";
import { HELIX } from "./layout";
import { liveMaterial, trackLive, withTiles } from "./materials";
import { plug } from "./plug";
import { markLoaded } from "./power";
import { ROBOTS, robotInSlot } from "./robots";
import { ITEMS } from "./items";
import { N_ITEMS, ROBOT_SLOTS, itemInSlot, itemShell, matches, setHover, spiral, stepPose } from "./spiral";

/** Graphite, the default shell: glossy near-black plastic (linear RGB). */
export const GRAPHITE = [0.032, 0.033, 0.036] as const;

/** Instances: the jobs first (instance i is job i), then the robots in slots 0–4. */
export const N = N_ITEMS + ROBOT_SLOTS.length;
const robotSlot = (k: number) => ROBOT_SLOTS[k - N_ITEMS];
/** The instance in a helix slot. */
export function instanceInSlot(slot: number): number {
  const i = itemInSlot(slot);
  return i >= 0 ? i : ROBOT_SLOTS.indexOf(slot) >= 0 ? N_ITEMS + ROBOT_SLOTS.indexOf(slot) : -1;
}
/** What an instance is called (the hover tip). */
export function instanceLabel(k: number): string {
  if (k < N_ITEMS) return ITEMS[k].title;
  return robotInSlot(robotSlot(k))?.name ?? HELIX[robotSlot(k)].code;
}

const TILES = [...ITEMS.map((_, i) => ITEM_TILE0 + i), ...ROBOT_SLOTS.map((s) => ROBOTS.findIndex((r) => r.code === robotInSlot(s)?.code))];
const ROBOT_BASE = ROBOT_SLOTS.map((s) => slotMatrix(HELIX[s]));
const shells = [...ITEMS.map((_, i) => itemShell(i)), ...ROBOT_SLOTS.map((s) => new THREE.Color().setRGB(...(HELIX[s].shell ?? GRAPHITE), THREE.LinearSRGBColorSpace))];

/** What the cartridge in a helix slot looks like: its label tile and shell tint (the machine's copy). */
export function slotLook(slot: number): { tile: number; shell: THREE.Color } {
  const k = instanceInSlot(slot);
  return k < 0 ? { tile: 0, shell: new THREE.Color().setRGB(...GRAPHITE, THREE.LinearSRGBColorSpace) } : { tile: TILES[k], shell: shells[k] };
}
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Metres out of the slot per unit of pop, and up. */
const OUT_M = 1.1;
const UP_M = 0.1;
/** Pop: the front one, the pointed-at one, the open one. */
const POP = { front: 0.45, hover: 0.3, open: 1.15 };
const SLIDE_RATE = 3.2;
const POP_RATE = 7;
const DIM = { off: 0.2, others: 0.35 };

export interface HelixProps {
  quality: QualityTier;
  reduced: boolean;
  /** Whether the cartridges answer the pointer now. */
  active: () => boolean;
  /** Whether the front cartridge stands out (the workshop is browsing). */
  browsing: () => boolean;
  onPick: (instance: number) => void;
}

export function Helix({ quality, reduced, active, browsing, onPick }: HelixProps) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  const invalidate = useThree((s) => s.invalidate);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const proxyRef = useRef<THREE.InstancedMesh | null>(null);
  const st = useMemo(() => ({ pop: new Float32Array(N), dim: new Float32Array(N).fill(1), shown: -1, first: true }), []);

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
    st.first = true;
    invalidate();
    return () => {
      releases.forEach((r) => r());
      offRedraw(redraw);
    };
  }, [parts, invalidate, st]);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const p3 = useMemo(() => new THREE.Vector3(), []);
  const q4 = useMemo(() => new THREE.Quaternion(), []);
  const s3 = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const o3 = useMemo(() => new THREE.Vector3(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const ks = reduced ? 1 : 1 - Math.exp(-dt * SLIDE_RATE);
    const kp = reduced ? 1 : 1 - Math.exp(-dt * POP_RATE);
    const away = plug.progress > 0 ? instanceInSlot(plug.slot) : -1;
    const front = browsing();
    let moving = st.first || away !== st.shown;
    let recolor = st.first;
    st.shown = away;

    for (let k = 0; k < N; k++) {
      const item = k < N_ITEMS;
      if (item) {
        const d = spiral.target[k] - spiral.pos[k];
        if (d !== 0) {
          spiral.pos[k] = Math.abs(d) < 0.002 ? spiral.target[k] : spiral.pos[k] + d * ks;
          moving = true;
        }
      }
      const isFront = item && front && Math.abs(spiral.pos[k] - spiral.step) < 0.5;
      const target = item && spiral.selected === k ? POP.open : (isFront ? POP.front : 0) + (spiral.hover === k ? POP.hover : 0);
      const dp = target - st.pop[k];
      if (dp !== 0) {
        st.pop[k] = Math.abs(dp) < 0.002 ? target : st.pop[k] + dp * kp;
        moving = true;
      }
      let dimTarget = item ? (matches(k) ? 1 : DIM.off) : spiral.filter ? DIM.others : 1;
      if (spiral.selected >= 0 && spiral.selected !== k) dimTarget *= DIM.others;
      const dd = dimTarget - st.dim[k];
      if (dd !== 0) {
        st.dim[k] = Math.abs(dd) < 0.004 ? dimTarget : st.dim[k] + dd * kp;
        recolor = true;
      }
    }
    st.first = false;

    if (moving) {
      for (let k = 0; k < N; k++) {
        let mat: THREE.Matrix4;
        if (k === away) mat = HIDDEN;
        else {
          if (k < N_ITEMS) {
            stepPose(spiral.pos[k], p3, q4);
            m4.compose(p3, q4, s3);
          } else m4.copy(ROBOT_BASE[k - N_ITEMS]);
          const pop = st.pop[k];
          if (pop > 0) {
            o3.set(0, 0, 1).applyQuaternion(q4.setFromRotationMatrix(m4));
            m4.elements[12] += o3.x * OUT_M * pop;
            m4.elements[13] += o3.y * OUT_M * pop + UP_M * pop;
            m4.elements[14] += o3.z * OUT_M * pop;
          }
          mat = m4;
        }
        meshes.current.forEach((m) => m?.setMatrixAt(k, mat));
        proxyRef.current?.setMatrixAt(k, mat);
      }
      meshes.current.forEach((m) => m && (m.instanceMatrix.needsUpdate = true));
      if (proxyRef.current) {
        proxyRef.current.instanceMatrix.needsUpdate = true;
        proxyRef.current.computeBoundingSphere();
      }
    }
    if (recolor) {
      meshes.current.forEach((m, j) => {
        if (!m) return;
        const part = parts[j];
        for (let k = 0; k < N; k++) {
          if (part?.isShell) col.copy(shells[k]).multiplyScalar(st.dim[k]);
          else col.setScalar(st.dim[k]);
          m.setColorAt(k, col);
        }
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      });
    }
    if (moving || recolor) invalidate();
  });

  const point = (e: ThreeEvent<PointerEvent>) => {
    const k = e.instanceId ?? -1;
    if (!active() || k < 0) return leave();
    e.stopPropagation();
    if (spiral.hover !== k) {
      setHover(k);
      document.body.style.cursor = "pointer";
      invalidate();
    }
  };
  const leave = () => {
    if (spiral.hover < 0) return;
    setHover(-1);
    document.body.style.cursor = "";
    invalidate();
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!active() || e.instanceId === undefined) return;
    e.stopPropagation();
    onPick(e.instanceId);
  };
  useEffect(
    () => () => {
      document.body.style.cursor = "";
      setHover(-1);
    },
    [],
  );

  return (
    <group name="helix">
      {parts.map((p, k) => (
        <instancedMesh key={p.name} ref={(m) => (meshes.current[k] = m)} args={[p.geometry, p.material, N]} raycast={() => null} name={`helix:${p.name}`} frustumCulled={false} />
      ))}
      <instancedMesh ref={proxyRef} args={[proxy, proxyMat, N]} onPointerMove={point} onPointerOut={leave} onClick={click} name="helix:hits" />
    </group>
  );
}
