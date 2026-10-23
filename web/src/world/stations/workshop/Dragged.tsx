// The cartridge in the hand (drag.ts), and the arm's part in it. cartridge.glb's parts dressed as the
// one picked up (its label tile and shell, Helix.slotLook). It choreographs the arm (armTask.ts;
// Arm.tsx puts the fingertips where it says, and the spiral parts round the arm):
// - pick: the hand comes down onto the cartridge's top edge, closes, and pulls it out of its slot;
// - carry: it follows the pointer on a plane that faces the camera through where it was grabbed,
//   label to you and leaning with the pointer's speed, never through a table, a wall or the spiral
//   (collide.ts: over and along them) and never out of the arm's reach;
// - over the machine: it glides to the port and waits there edge-on while a light stands up out of
//   the slot (the drop target), and the hand's light comes up;
// - let go there and the machine takes it (useSend, held): the arm keeps hold and lowers it in, on
//   the machine's own insert (Arm.tsx); let go anywhere else, or Escape, and the arm puts it back.
// Drawn only while a cartridge is in the hand: the room view's draw calls stay as they were.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWorld } from "../../core/WorldContext";
import type { QualityTier } from "../../core/quality";
import { armTask } from "../../scene/armTask";
import { faceYaw } from "../../scene/Arm";
import { CARTRIDGE_URL } from "../../scene/assets";
import { cartridgeParts, labelAtlas } from "../../scene/cartridge";
import { slotLook } from "../../scene/Helix";
import { tileUv } from "../../scene/labels";
import { slotAt } from "../../scene/layout";
import { liveMaterial, trackLive } from "../../scene/materials";
import { plug } from "../../scene/plug";
import { PLUGGED_Q, PORT_TOP } from "../../scene/plugSequence";
import { setHover } from "../../scene/spiral";
import { MAGNET, PICK_S, backStep, cancel, carryStep, drag, gripOf, move, onPlane, pickStep, rayHitsBox, release, setOver, settle, type PickStep, type Pose } from "./drag";
import { useSend } from "./send";
import { closeShelf } from "./stepper";

/** How fast it catches up with the port (1/s). */
const SNAP = 11;
/** Let go over the machine: it hands over once it has reached the port, or after this long anyway. */
const HAND_S = 0.35;
/** Most it leans with the pointer's speed (radians), and how much per pixel a frame. */
const LEAN_MAX = 0.32;
const LEAN_PER_PX = 0.01;
const TEAL = "#3FE0C0";
/** The drop target's light: a column standing up out of the slot, as wide as the cartridge. */
const BEAM_H = 2.4;

const beamVert = /* glsl */ `
varying float vUp;
void main() {
  vUp = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;
varying float vUp;
void main() {
  // Rising bands while it is a target (uLevel near 1), a still glow while it is only a hint.
  float bands = 0.75 + 0.25 * sin(vUp * 18.0 - uTime * 6.0) * smoothstep(0.5, 1.0, uLevel);
  float a = pow(1.0 - vUp, 1.8) * uLevel * bands;
  gl_FragColor = vec4(uColor * a, a);
}`;

function useHand(tier: QualityTier) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  return useMemo(() => {
    const group = new THREE.Group();
    group.name = "drag:cartridge";
    const releases: (() => void)[] = [];
    const label = labelAtlas().clone();
    label.needsUpdate = true;
    let shell: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null = null;
    for (const p of cartridgeParts(gltf.scene)) {
      const isLabel = p.name.startsWith("label");
      const isWindow = p.name.startsWith("window");
      const isShell = p.name.startsWith("shell");
      const m = liveMaterial(p.source, tier, isLabel ? { map: label, color: "#ffffff" } : isWindow ? { transparent: true, opacity: 0.35 } : isShell ? { color: "#ffffff" } : {});
      releases.push(trackLive(m));
      if (isShell) shell = m as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
      const mesh = new THREE.Mesh(p.geometry, m);
      mesh.raycast = () => {};
      group.add(mesh);
    }
    group.visible = false;
    /** Wear the label and shell of what is in `slot` (as the machine's copy does). */
    const dress = (slot: number) => {
      const look = slotLook(slot);
      const r = tileUv(look.tile);
      label.offset.set(r.u, r.v + r.sv);
      label.repeat.set(r.su, -r.sv);
      shell?.color.copy(look.shell);
    };
    return { group, dress, releases: [...releases, () => label.dispose()] };
  }, [gltf, tier]);
}

function useBeam() {
  return useMemo(() => {
    const geometry = new THREE.CylinderGeometry(1, 1, BEAM_H, 32, 1, true).translate(0, BEAM_H / 2, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: { uColor: { value: new THREE.Color(TEAL) }, uLevel: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "drag:target";
    mesh.position.copy(PORT_TOP);
    // Its footprint is the cartridge's: wide along the slot, thin across it.
    mesh.quaternion.copy(PLUGGED_Q);
    mesh.scale.set(1.3, 1, 0.32);
    mesh.raycast = () => {};
    mesh.visible = false;
    mesh.renderOrder = 2;
    return { mesh, level: material.uniforms.uLevel, time: material.uniforms.uTime, release: () => (geometry.dispose(), material.dispose()) };
  }, []);
}

const _ndc = new THREE.Vector2();
const _fwd = new THREE.Vector3();
const _at = new THREE.Vector3();
const _next = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lean = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const pose = (): Pose => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
const pickState = (): PickStep => ({ pose: pose(), grip: new THREE.Vector3(), closed: 0 });

/** The pose of a spiral slot. */
function slotPose(slot: number, out: Pose): Pose {
  const s = slotAt(slot);
  out.position.set(...s.position);
  out.quaternion.set(...s.quaternion);
  return out;
}

/** Steer the arm: fingertips at `grip`, the hand lined up across a cartridge turned by `q`, closed by `closed`. */
function steer(grip: THREE.Vector3, q: THREE.Quaternion, closed: number): void {
  armTask.active = true;
  armTask.grip.copy(grip);
  armTask.handYaw = faceYaw(q);
  armTask.closed = closed;
}

export function Dragged({ quality, reduced }: { quality: QualityTier; reduced: boolean }) {
  const { store } = useWorld();
  const send = useSend();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const raycaster = useThree((s) => s.raycaster);
  const invalidate = useThree((s) => s.invalidate);
  const hand = useHand(quality);
  const beam = useBeam();
  const st = useRef({
    phase: drag.phase as string,
    t0: 0,
    grab: new THREE.Vector3(),
    pose: pose(),
    home: pose(),
    from: pose(),
    handStart: new THREE.Vector3(),
    step: pickState(),
    lean: 0,
    lastX: 0,
    handed: false,
    sent: false,
    glow: 0,
    locked: false,
  });

  useEffect(() => () => hand.releases.forEach((r) => r()), [hand]);
  useEffect(() => () => beam.release(), [beam]);
  // Unmounted mid-drag: the arm goes back to looking about.
  useEffect(() => () => void (armTask.active = false), []);

  // The pointer, anywhere on the page (over the overlays too): drag.ts decides what it means.
  useEffect(() => {
    const canvas = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const r = move(e.pointerId, e.clientX, e.clientY);
      if (!r) return;
      if (r === "start") {
        // Out of the slot and into the hand: the shelf lets go (the room view shows the machine), nothing stays lifted.
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
        setHover(-1);
        closeShelf(store);
        document.body.style.cursor = "grabbing";
      }
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      if (release(e.pointerId) === null) return;
      document.body.style.cursor = "";
      invalidate();
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      cancel();
      document.body.style.cursor = "";
      invalidate();
    };
    // Escape puts it back, before the shelf or the filters hear it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || drag.phase !== "drag") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
      document.body.style.cursor = "";
      invalidate();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      canvas.style.touchAction = "";
    };
  }, [gl, store, invalidate]);

  useFrame((state, delta) => {
    const s = st.current;
    const now = state.clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const canvas = gl.domElement;

    // While the room holds the page still, a finger on the canvas drags a cartridge, never the page.
    const locked = store.getCoarse().current === "workshop" && store.frames.workshop.arrive >= 1;
    if (locked !== s.locked) {
      s.locked = locked;
      canvas.style.touchAction = locked ? "none" : "";
    }

    const phase = drag.phase;
    if (phase !== s.phase) {
      const was = s.phase;
      s.phase = phase;
      s.t0 = now;
      if (phase === "drag" && was === "press") {
        // Picked up from its slot: the arm comes for it from wherever its hand is.
        hand.dress(drag.slot);
        slotPose(drag.slot, s.home);
        s.pose.position.copy(s.home.position);
        s.pose.quaternion.copy(s.home.quaternion);
        s.grab.copy(s.home.position);
        s.handStart.copy(armTask.hand);
        s.lean = 0;
        s.lastX = drag.x;
        s.handed = false;
        s.sent = false;
      }
      if (phase === "back") {
        s.from.position.copy(s.pose.position);
        s.from.quaternion.copy(s.pose.quaternion);
        slotPose(drag.slot, s.home);
      }
    }

    const live = phase === "drag" || phase === "drop" || phase === "back";
    hand.group.visible = live;
    if (!live) {
      s.glow = 0;
      beam.mesh.visible = false;
      armTask.glow = 0;
      return;
    }

    // A drag the room lost (a branch opened, Ask SANT moved the camera): back to the spiral.
    if (phase === "drag" && (store.getCoarse().branch !== null || store.getCoarse().current !== "workshop")) cancel();

    let glowTo = 0;
    const picking = phase === "drag" && !reduced && now - s.t0 < PICK_S;
    if (phase === "drag") {
      const r = canvas.getBoundingClientRect();
      _ndc.set(((drag.x - r.left) / r.width) * 2 - 1, -((drag.y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(_ndc, camera);
      const { origin, direction } = raycaster.ray;
      // Over the machine counts only once the cartridge is out of its slot.
      const over = !picking && rayHitsBox(origin, direction);
      // The pointer says so too: a drop here loads it.
      if (over !== drag.over) document.body.style.cursor = over ? "copy" : "grabbing";
      setOver(over);
      if (picking) {
        // The arm takes it: down onto the top edge, closing, out of the slot.
        pickStep(s.home, s.handStart, now - s.t0, s.step);
        s.pose.position.copy(s.step.pose.position);
        s.pose.quaternion.copy(s.step.pose.quaternion);
        steer(s.step.grip, s.pose.quaternion, s.step.closed);
      } else {
        if (over) {
          _at.copy(MAGNET.position);
          _q.copy(MAGNET.quaternion);
        } else {
          camera.getWorldDirection(_fwd);
          if (!onPlane(origin, direction, s.grab, _fwd, _at)) _at.copy(s.pose.position);
          // Its label to you, leaning the way the pointer goes.
          const leanTo = THREE.MathUtils.clamp(-(drag.x - s.lastX) * LEAN_PER_PX, -LEAN_MAX, LEAN_MAX);
          s.lean += (leanTo - s.lean) * (reduced ? 1 : 1 - Math.exp(-dt * 8));
          _q.setFromAxisAngle(Y, Math.atan2(camera.position.x - _at.x, camera.position.z - _at.z)).multiply(_lean.setFromAxisAngle(Z, s.lean));
        }
        const kq = reduced ? 1 : 1 - Math.exp(-dt * (over ? SNAP : 9));
        s.pose.quaternion.slerp(_q, kq);
        if (over) {
          // The port is clear above the machine: glide straight to it.
          s.pose.position.lerp(_at, reduced ? 1 : 1 - Math.exp(-dt * SNAP));
        } else {
          carryStep(s.pose.position, _at, s.pose.quaternion, reduced ? 1 : dt, _next);
          s.pose.position.copy(_next);
        }
        steer(gripOf(s.pose, _next), s.pose.quaternion, 1);
      }
      s.lastX = drag.x;
      glowTo = over ? 1 : picking ? 0 : 0.4 + 0.12 * Math.sin(now * 5);
      armTask.glow = over ? 1 : 0;
    } else if (phase === "drop") {
      const k = reduced ? 1 : 1 - Math.exp(-dt * SNAP);
      s.pose.position.lerp(MAGNET.position, k);
      s.pose.quaternion.slerp(MAGNET.quaternion, k);
      steer(gripOf(s.pose, _next), s.pose.quaternion, 1);
      const there = s.pose.position.distanceTo(MAGNET.position) < 0.03;
      if (!s.handed && (there || now - s.t0 > HAND_S)) {
        s.handed = true;
        s.pose.position.copy(MAGNET.position);
        s.pose.quaternion.copy(MAGNET.quaternion);
        const slot = drag.slot;
        // Not inside the canvas's frame: opening the machine re-renders the overlays.
        setTimeout(() => {
          send(slot, { held: true });
          s.sent = true;
        }, 0);
      }
      // The machine's copy has it once it has taken the request and its plug-in is running (not an
      // earlier one's progress): let go of ours, and the arm follows the machine's insert (Arm.tsx).
      // (A machine that never answers doesn't keep it in the hand for ever.)
      if (s.sent && ((!plug.requested && plug.slot === drag.slot && plug.progress > 0) || now - s.t0 > 2.5)) {
        armTask.active = false;
        settle();
      }
      glowTo = s.handed ? 0 : 1;
    } else {
      // Put back: round the spiral to its slot, in, and the fingers open.
      const r = backStep(s.from, s.home, reduced ? Infinity : now - s.t0, s.step);
      s.pose.position.copy(s.step.pose.position);
      s.pose.quaternion.copy(s.step.pose.quaternion);
      steer(s.step.grip, s.pose.quaternion, s.step.closed);
      if (r.done) {
        armTask.active = false;
        settle();
      }
    }

    hand.group.position.copy(s.pose.position);
    hand.group.quaternion.copy(s.pose.quaternion);
    s.glow += (glowTo - s.glow) * (reduced ? 1 : 1 - Math.exp(-dt * 10));
    beam.level.value = s.glow;
    beam.time.value = now;
    beam.mesh.visible = s.glow > 0.01;
    invalidate();
  });

  return (
    <group name="drag">
      <primitive object={hand.group} />
      <primitive object={beam.mesh} />
    </group>
  );
}
