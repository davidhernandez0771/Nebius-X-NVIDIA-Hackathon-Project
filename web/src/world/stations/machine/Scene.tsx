// The machine's live parts, from machine.glb (its desk and body are baked, in the workshop's room):
// - the two fans, spinning on high and ultra while the lamps are on (an idle loop, so never on low);
// - the teal lights: the strip along the front, the fan marks, the slot (it flashes as a cartridge
//   seats) and the projector's lens;
// - the hologram: the beam, the wireframe arm and the Record screen, coming up after the click;
// - the cartridge on its way: from its spiral slot to the port (scene/plugSequence.ts). A click
//   runs it in PLUG_S; with nobody choosing, the machine's own dwell plugs the default one in.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MACHINE_ANCHOR } from "../../core/layout";
import type { StationSceneProps } from "../../core/types";
import { CARTRIDGE_URL, MACHINE_URL } from "../../scene/assets";
import { cartridgeParts, labelAtlas } from "../../scene/cartridge";
import { slotLook } from "../../scene/Helix";
import { tileUv } from "../../scene/labels";
import { liveMaterial, trackLive } from "../../scene/materials";
import { plug } from "../../scene/plug";
import { cartridgePose, projection, scrollU, slotGlow, timeU, type CartridgePose } from "../../scene/plugSequence";
import { addGlow, markLoaded, power, setGlowGain } from "../../scene/power";

const FAN_RPS = 0.9;
/** The projector's lens before it projects: a faint ready light. */
const LENS_IDLE = 0.12;
const is = (o: THREE.Object3D, ...names: string[]) => names.some((n) => o.name.startsWith(`mx_M_${n}`));

interface Built {
  root: THREE.Group;
  fans: THREE.Group[];
  slot: THREE.MeshBasicMaterial;
  lens: THREE.MeshBasicMaterial;
  holo: { mat: THREE.MeshBasicMaterial; peak: number }[];
  screen: THREE.Object3D | null;
  releases: (() => void)[];
}

/** Pick the live nodes out of machine.glb (cloned, so the cached file stays as loaded) with tier materials. */
function build(scene: THREE.Object3D, tier: StationSceneProps["quality"]): Built {
  const root = new THREE.Group();
  const releases: (() => void)[] = [];
  const glow = (src: THREE.Material, gain = 1) => {
    const s = src as THREE.MeshStandardMaterial;
    const m = new THREE.MeshBasicMaterial({ toneMapped: false, name: s.name });
    releases.push(addGlow(m, s.emissive), () => m.dispose());
    setGlowGain(m, gain);
    return m;
  };
  const holo = (m: THREE.MeshBasicMaterial, peak: number) => {
    m.transparent = true;
    m.opacity = 0;
    m.depthWrite = false;
    return { mat: m, peak };
  };
  const metal = new Map<THREE.Material, THREE.Material>();
  const metalFor = (src: THREE.Material) => {
    let m = metal.get(src);
    if (!m) {
      m = liveMaterial(src, tier);
      metal.set(src, m);
      releases.push(trackLive(m));
    }
    return m;
  };

  const fanAt = [new THREE.Group(), new THREE.Group()];
  const holos: Built["holo"] = [];
  const stripGlow = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  let slot: THREE.MeshBasicMaterial | null = null;
  let lens: THREE.MeshBasicMaterial | null = null;
  let screen: THREE.Object3D | null = null;

  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const src = o.material as THREE.MeshStandardMaterial;
    let mat: THREE.Material;
    let parent: THREE.Object3D = root;
    if (is(o, "FanHub", "FanMark", "Blade", "FanRing")) {
      const k = o.position.x < 0 ? 0 : 1;
      if (is(o, "FanRing")) mat = metalFor(src);
      else {
        // Spin about the fan's own centre: parent it to a group there.
        const g = fanAt[k];
        if (g.parent === null) {
          g.position.set(o.position.x, 0, o.position.z);
          root.add(g);
        }
        parent = g;
        mat = is(o, "FanMark") ? (stripGlow.get(src) ?? stripGlow.set(src, glow(src)).get(src)!) : metalFor(src);
      }
    } else if (is(o, "SlotGlow")) mat = slot = glow(src, 0);
    else if (is(o, "Lens")) mat = lens = glow(src, LENS_IDLE);
    else if (is(o, "GlowStrip")) mat = stripGlow.get(src) ?? stripGlow.set(src, glow(src)).get(src)!;
    else if (is(o, "HoloBeam")) {
      const m = glow(src);
      m.blending = THREE.AdditiveBlending;
      m.side = THREE.DoubleSide;
      holos.push(holo(m, 0.08));
      mat = m;
    } else if (is(o, "HoloScreen")) {
      const m = glow(src);
      m.map = src.emissiveMap;
      m.side = THREE.DoubleSide;
      holos.push(holo(m, 0.96));
      mat = m;
    } else if (is(o, "Holo_")) {
      const m = glow(src);
      m.wireframe = true;
      m.blending = THREE.AdditiveBlending;
      holos.push(holo(m, 0.85));
      mat = m;
    } else return; // baked: the desk, fins, shroud, vents, heat pipes, cable, port
    const mesh = new THREE.Mesh(o.geometry, mat);
    mesh.name = o.name;
    mesh.position.copy(o.position);
    mesh.quaternion.copy(o.quaternion);
    mesh.scale.copy(o.scale);
    if (parent !== root) mesh.position.sub(parent.position);
    if (is(o, "HoloScreen")) screen = mesh;
    mesh.raycast = () => {};
    parent.add(mesh);
  });
  return { root, fans: fanAt, slot: slot!, lens: lens!, holo: holos, screen, releases };
}

/** The cartridge in flight and plugged in: cartridge.glb's parts as plain meshes, retinted per slot. */
function useHero(tier: StationSceneProps["quality"]) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  return useMemo(() => {
    const group = new THREE.Group();
    const releases: (() => void)[] = [];
    const label = labelAtlas().clone();
    label.needsUpdate = true;
    const tinted: { shell: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null } = { shell: null };
    for (const p of cartridgeParts(gltf.scene)) {
      const isLabel = p.name.startsWith("label");
      const isWindow = p.name.startsWith("window");
      const isShell = p.name.startsWith("shell");
      const m = liveMaterial(p.source, tier, isLabel ? { map: label, color: "#ffffff" } : isWindow ? { transparent: true, opacity: 0.35 } : isShell ? { color: "#ffffff" } : {});
      releases.push(trackLive(m));
      if (p.name.startsWith("shell")) tinted.shell = m as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
      const mesh = new THREE.Mesh(p.geometry, m);
      mesh.raycast = () => {};
      group.add(mesh);
    }
    group.visible = false;
    /** Show the label and shell of whatever is in `slot` (a job or a robot, Helix.slotLook). */
    const dress = (slot: number) => {
      const look = slotLook(slot);
      const r = tileUv(look.tile);
      // The label mesh's v runs downward: flip it into the tile (as materials.ts withTiles does).
      label.offset.set(r.u, r.v + r.sv);
      label.repeat.set(r.su, -r.sv);
      tinted.shell?.color.copy(look.shell);
    };
    return { group, dress, releases: [...releases, () => label.dispose()] };
  }, [gltf, tier]);
}

const ANCHOR = new THREE.Vector3(...MACHINE_ANCHOR);

export function MachineScene({ frame, quality, reduced }: StationSceneProps) {
  const gltf = useGLTF(MACHINE_URL, false);
  const invalidate = useThree((s) => s.invalidate);
  const built = useMemo(() => build(gltf.scene, quality), [gltf, quality]);
  const hero = useHero(quality);
  const st = useRef({ clicked: false, startedAt: 0, dressed: -1, pose: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } as CartridgePose });

  useEffect(() => {
    markLoaded(MACHINE_URL);
    invalidate();
    return () => built.releases.forEach((r) => r());
  }, [built, invalidate]);
  useEffect(() => () => hero.releases.forEach((r) => r()), [hero]);

  useFrame(({ clock }) => {
    const s = st.current;
    const now = clock.elapsedTime;
    if (plug.requested) {
      plug.requested = false;
      s.clicked = true;
      s.startedAt = now;
      // The slot's contents may have changed since (a filter reorders the jobs): dress it again.
      s.dressed = -1;
    }
    const u = s.clicked ? timeU(s.startedAt, now, reduced) : scrollU(frame.t);
    plug.progress = u;

    if (s.dressed !== plug.slot) {
      hero.dress(plug.slot);
      s.dressed = plug.slot;
    }
    hero.group.visible = u > 0;
    if (u > 0) {
      cartridgePose(plug.slot, u, s.pose);
      hero.group.position.copy(s.pose.position).sub(ANCHOR);
      hero.group.quaternion.copy(s.pose.quaternion);
    }

    setGlowGain(built.slot, slotGlow(u));
    const p = projection(u);
    setGlowGain(built.lens, LENS_IDLE + (1 - LENS_IDLE) * p);
    // A faint flicker in the projection on ultra (it already renders every frame there).
    const flicker = quality.haze && p > 0 ? 0.94 + 0.06 * Math.sin(now * 37) * Math.sin(now * 11.3) : 1;
    for (const h of built.holo) h.mat.opacity = h.peak * p * flicker;
    // The screen unfolds upward as it lights (its height is the plane's local z).
    if (built.screen) built.screen.scale.z = (built.screen.userData.sz ??= built.screen.scale.z) * (0.6 + 0.4 * p);

    const spinning = quality.idleMotion && frame.near && power.level > 0.5;
    if (spinning) {
      const a = now * FAN_RPS * Math.PI * 2;
      built.fans[0].rotation.y = a;
      built.fans[1].rotation.y = -a * 1.07;
    }
    if (spinning || (s.clicked && u < 1)) invalidate();
  });

  return (
    <group>
      <primitive object={built.root} />
      <primitive object={hero.group} />
    </group>
  );
}
