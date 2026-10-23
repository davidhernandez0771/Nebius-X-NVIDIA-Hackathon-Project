// The machine, from machine_v2.glb (scene/machineV2.ts): a realistic GPU-style card on the desk, drawn
// live with its metals' reflections (the desk is baked, and the room's baked machine body keeps only the
// power cable and plug, workshop/Scene.tsx):
// - the body: every non-glowing part in one mesh, its colour, metalness and roughness per vertex;
// - the two fans, turning slowly on high and ultra while the lamps are on (an idle loop, so never on low);
// - the teal lights: the strip along the front and the dock's marks, the fan marks, the dock's slot
//   (it flashes as a cartridge seats) and the projector's lens;
// - the cartridge bay on the dock (scene/bay.ts): the model's slot is a shallow plate narrower than a
//   cartridge, so a code-built sleeve sized to the cartridge stands on it; its lip is the slot light;
// - the hologram: machine.glb's Record screen, and the particle twin over the lens (HoloTwin), coming up
//   after the click;
// - the cartridge on its way: from its spiral slot into the dock (scene/plugSequence.ts). A click runs
//   it in PLUG_S; with nobody choosing, the machine's own dwell plugs the default one in.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR } from "../../core/layout";
import { ambient } from "../../core/activity";
import { useWorld, useWorldState } from "../../core/WorldContext";
import { HoloTwin } from "../../scene/HoloTwin";
import type { StationSceneProps } from "../../core/types";
import { CARTRIDGE_URL, MACHINE_URL, MACHINE_V2_URL } from "../../scene/assets";
import { Materialize } from "../../scene/Materialize";
import { cartridgeParts, labelAtlas } from "../../scene/cartridge";
import { slotLook } from "../../scene/Helix";
import { tileUv } from "../../scene/labels";
import { bayGeometry } from "../../scene/bay";
import { MACHINE_PIVOT } from "../../scene/layout";
import { HOLO_ABOVE_LENS, splitMachineV2 } from "../../scene/machineV2";
import { liveMaterial, trackLive, vertexPbrMaterial } from "../../scene/materials";
import { plug } from "../../scene/plug";
import { DOCK_TOP, cartridgePose, projection, scrollU, slotGlow, timeU, type CartridgePose } from "../../scene/plugSequence";
import { addGlow, markLoaded, power, setGlowGain } from "../../scene/power";

/** Slow: a card at idle, not a jet. */
const FAN_RPS = 0.3;
/** The projector's lens before it projects: a faint ready light. */
const LENS_IDLE = 0.12;
/** The bay's lip before a cartridge seats: a faint ready light. */
const LIP_IDLE = 0.3;
const is = (o: THREE.Object3D, ...names: string[]) => names.some((n) => o.name.startsWith(`mx_M_${n}`));

interface Built {
  root: THREE.Group;
  fans: THREE.Group[];
  slot: THREE.MeshBasicMaterial;
  lip: THREE.MeshBasicMaterial;
  lens: THREE.MeshBasicMaterial;
  holo: { mat: THREE.MeshBasicMaterial; peak: number }[];
  screen: THREE.Object3D | null;
  /** Where the hologram stands, local to the machine: just over the lens. */
  holoAt: THREE.Vector3;
  releases: (() => void)[];
}

/** The machine from machine_v2.glb, and the hologram's screen from machine.glb, with tier materials. */
function build(old: THREE.Object3D, v2: THREE.Object3D, tier: StationSceneProps["quality"]): Built {
  const root = new THREE.Group();
  const releases: (() => void)[] = [];
  const glow = (color: THREE.Color, gain = 1, name = "glow") => {
    const m = new THREE.MeshBasicMaterial({ toneMapped: false, name });
    releases.push(addGlow(m, color), () => m.dispose());
    setGlowGain(m, gain);
    return m;
  };
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.raycast = () => {};
    parent.add(mesh);
    releases.push(() => geometry.dispose());
    return mesh;
  };

  const parts = splitMachineV2(v2);
  const pbr = vertexPbrMaterial(tier, "machine-v2");
  releases.push(trackLive(pbr));
  add(root, parts.body, pbr, "machine:body");
  const teal = glow(parts.glowColor, 1, "machine:glow");
  add(root, parts.glow, teal, "machine:glow");
  const slot = glow(parts.glowColor, 0, "machine:slot");
  add(root, parts.slot, slot, "machine:slot");
  // The bay over the dock's slot plate: its shell in the body's material, its lip in the slot's light.
  const bay = bayGeometry();
  const bayGroup = new THREE.Group();
  bayGroup.name = "machine:bay";
  bayGroup.position.copy(DOCK_TOP).sub(new THREE.Vector3(...MACHINE_ANCHOR));
  bayGroup.rotation.y = MACHINE_PIVOT.yaw;
  add(bayGroup, bay.shell, pbr, "machine:bay:shell");
  // A faint ready light round the mouth; it flashes with the slot as a cartridge seats.
  const lip = glow(parts.glowColor, LIP_IDLE, "machine:bay:lip");
  add(bayGroup, bay.lip, lip, "machine:bay:lip");
  root.add(bayGroup);
  const lens = glow(parts.lensColor, LENS_IDLE, "machine:lens");
  add(root, parts.lens, lens, "machine:lens");
  const fans = parts.fans.map((f, k) => {
    // Turns about the fan's own axis: a group there.
    const g = new THREE.Group();
    g.name = `machine:fan${k}`;
    g.position.set(f.centre.x, 0, f.centre.z);
    add(g, f.body, pbr, `machine:fan${k}:blades`);
    add(g, f.mark, teal, `machine:fan${k}:mark`);
    root.add(g);
    return g;
  });

  // The Record screen over the hologram, from machine.glb (its beam and wire arm gave way to HoloTwin).
  const holos: Built["holo"] = [];
  let screen: THREE.Object3D | null = null;
  old.updateMatrixWorld(true);
  old.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !is(o, "HoloScreen")) return;
    const src = o.material as THREE.MeshStandardMaterial;
    const m = glow(src.emissive, 1, src.name);
    m.map = src.emissiveMap;
    m.side = THREE.DoubleSide;
    m.transparent = true;
    m.opacity = 0;
    m.depthWrite = false;
    holos.push({ mat: m, peak: 0.96 });
    const mesh = new THREE.Mesh(o.geometry, m);
    mesh.name = o.name;
    mesh.position.copy(o.position);
    mesh.quaternion.copy(o.quaternion);
    mesh.scale.copy(o.scale);
    mesh.raycast = () => {};
    root.add(mesh);
    screen = mesh;
  });
  return { root, fans, slot, lip, lens, holo: holos, screen, holoAt: parts.lensTop.clone().setY(parts.lensTop.y + HOLO_ABOVE_LENS), releases };
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

/** After PLUG IN: a breath with the hologram up, then into the projection (the zoom) to the page. */
const AUTOPLAY_PAUSE_MS = 2200;

export function MachineScene({ frame, quality, reduced }: StationSceneProps) {
  const { store, goTo } = useWorld();
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  const gltf = useGLTF(MACHINE_URL, false);
  const v2 = useGLTF(MACHINE_V2_URL, false);
  const invalidate = useThree((s) => s.invalidate);
  const built = useMemo(() => build(gltf.scene, v2.scene, quality), [gltf, v2, quality]);
  const hero = useHero(quality);
  const st = useRef({ clicked: false, startedAt: 0, dressed: -1, pose: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } as CartridgePose });

  useEffect(() => {
    markLoaded(MACHINE_URL);
    markLoaded(MACHINE_V2_URL);
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
    // PLUG IN: once it is in and projecting, glide on through the zoom; the handoff opens the page.
    if (s.clicked && u >= 1 && plug.autoplay) {
      plug.autoplay = false;
      setTimeout(() => {
        if (store.getCoarse().branch === "machine") goTo("zoom");
      }, reduced ? 0 : AUTOPLAY_PAUSE_MS);
    }

    if (s.dressed !== plug.slot) {
      hero.dress(plug.slot);
      s.dressed = plug.slot;
    }
    // A drop over the port (plug.held) is there from its first frame: the drag hands it over in place.
    const shown = u > 0 || (s.clicked && plug.held);
    hero.group.visible = shown;
    if (shown) {
      cartridgePose(plug.slot, u, s.pose, s.clicked && plug.held);
      hero.group.position.copy(s.pose.position).sub(ANCHOR);
      hero.group.quaternion.copy(s.pose.quaternion);
    }

    setGlowGain(built.slot, slotGlow(u));
    setGlowGain(built.lip, Math.max(LIP_IDLE, slotGlow(u)));
    const p = projection(u);
    setGlowGain(built.lens, LENS_IDLE + (1 - LENS_IDLE) * p);
    // A faint flicker in the projection on ultra (it already renders every frame there).
    const flicker = quality.haze && p > 0 ? 0.94 + 0.06 * Math.sin(now * 37) * Math.sin(now * 11.3) : 1;
    for (const h of built.holo) {
      h.mat.opacity = h.peak * p * flicker;
      // Dark until it projects: no draw calls for it before.
      h.mat.visible = p > 0;
    }
    // The screen unfolds upward as it lights (its height is the plane's local z).
    if (built.screen) built.screen.scale.z = (built.screen.userData.sz ??= built.screen.scale.z) * (0.6 + 0.4 * p);

    const spinning = quality.idleMotion && frame.near && power.level > 0.5;
    if (spinning) {
      const a = now * FAN_RPS * Math.PI * 2;
      built.fans[0].rotation.y = a;
      built.fans[1].rotation.y = -a * 1.07;
    }
    if (s.clicked && u < 1) invalidate();
    else if (spinning) ambient(invalidate);
  });

  return (
    <Materialize>
      <primitive object={built.root} />
      <primitive object={hero.group} />
      {frame.near ? <HoloTwin level={() => projection(plug.progress)} quality={quality} label={label} position={[built.holoAt.x, built.holoAt.y, built.holoAt.z]} /> : null}
    </Materialize>
  );
}
