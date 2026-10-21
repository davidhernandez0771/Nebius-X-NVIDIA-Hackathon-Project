// Moves the one camera. Full motion: follows the rail at the scroll position, damped so wheel steps
// glide, and tweens to and from a branch. Reduced motion: no travel at all; it cuts between the
// stations' rest poses behind a short fade (the veil). It asks for a frame only while moving.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { fitFov } from "./fov";
import { poseAt, reducedPoseAt, restPose, toWorld } from "./rail";
import { heldShot, mixShot, newShot, retarget, type ShotState } from "./shot";
import { onPointer, pointer } from "../ui/pointer";
import type { WorldStore } from "./store";
import type { CameraPose, StationModule } from "./types";

const DAMP = 7;
const SETTLE_PX = 0.5;
export { CUT_S } from "./shot";

interface RigState extends ShotState {
  shown: number;
  jumps: number;
  /** The playing branch: which one, and the clock time its t was 0. */
  play: { id: string; start: number } | null;
  /** The hub's look-around, eased toward the pointer. */
  look: { x: number; y: number };
}

/** In the workshop's room view the mouse turns the view a little: metres the camera moves. */
const LOOK_X = 0.9;
const LOOK_Y = 0.45;

/** The room view: the workshop, arrived, with nothing open. */
export function inHub(store: WorldStore): boolean {
  const c = store.getCoarse();
  return c.current === "workshop" && c.branch === null && c.override === null && store.frames.workshop.arrive >= 1;
}

export function applyPose(camera: PerspectiveCamera, p: CameraPose): void {
  camera.position.set(p.position[0], p.position[1], p.position[2]);
  camera.lookAt(p.target[0], p.target[1], p.target[2]);
  // Portrait screens see as much across as a square one (fov.ts).
  const fov = fitFov(p.fov, camera.aspect);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

export function CameraRig({
  store,
  stations,
  reduced,
  onCut,
}: {
  store: WorldStore;
  stations: readonly StationModule[];
  reduced: boolean;
  onCut: () => void;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef<RigState>({ ...newShot(), shown: store.targetY, jumps: store.jumps, play: null, look: { x: 0, y: 0 } });

  useEffect(() => store.onTarget(() => invalidate()), [store, invalidate]);
  // The room view follows the pointer: a frame when it moves there.
  useEffect(() => onPointer(() => inHub(store) && invalidate()), [store, invalidate]);
  useEffect(() => invalidate(), [reduced, invalidate]);

  // Priority -1: before every station's useFrame, so they read this frame's StationFrame.
  useFrame((state, delta) => {
    const s = st.current;
    const now = state.clock.elapsedTime;
    // After an idle stretch the first delta is the whole idle time: clamp it, or the damping jumps.
    const dt = Math.min(delta, 1 / 30);
    let moving = false;

    const target = store.targetY;
    // A jump (the journey rail, behind the iris): no glide and no tween, the camera is just there.
    if (s.jumps !== store.jumps) {
      s.jumps = store.jumps;
      s.shown = target;
      s.pose = null;
      s.tween = null;
      s.cutAt = null;
      s.glide = null;
    }
    if (reduced) s.shown = target;
    else {
      s.shown += (target - s.shown) * (1 - Math.exp(-DAMP * dt));
      if (Math.abs(target - s.shown) < SETTLE_PX) s.shown = target;
      else moving = true;
    }
    store.setShown(s.shown);

    const { branch, override } = store.getCoarse();
    const open = branch ? stations.find((m) => m.id === branch) : undefined;
    let dest: CameraPose;
    let key: string;
    let arc = false;
    if (open || !override) s.glide = null;
    if (open?.duration) {
      // A playing branch: its t runs on the clock from where it was opened (Back opens it played).
      if (s.play?.id !== open.id) s.play = { id: open.id, start: now - store.branchT0 * open.duration };
      const t = reduced ? 1 : Math.min(1, (now - s.play.start) / open.duration);
      store.setBranchT(t);
      if (t < 1) moving = true;
      dest = toWorld(open.anchor, open.camera(t));
      key = open.id;
    } else if (open?.shot) {
      const shot = open.shot();
      dest = toWorld(open.anchor, shot.pose);
      key = `${open.id}:${shot.key}`;
    } else if (open) {
      dest = restPose(open);
      key = open.id;
    } else if (override) {
      // A held shot; on a track (the shelf) the camera glides along it, round the spiral.
      const held = heldShot(s, override, dt, reduced);
      ({ dest, key, arc } = held);
      if (held.moving) moving = true;
    } else if (reduced) {
      const r = reducedPoseAt(store.rails, store.rail, s.shown);
      dest = r.pose;
      key = store.rails[r.index].id;
    } else {
      dest = poseAt(store.rails, store.rail, s.shown);
      key = "rail";
    }

    if (retarget(s, dest, key, now, reduced, arc)) onCut();

    if (!open) s.play = null;
    // The room view looks round a little with the mouse (not with reduced motion).
    const hub = !reduced && key === "rail" && inHub(store);
    const lx = hub ? pointer.x : 0;
    const ly = hub ? pointer.y : 0;
    s.look.x += (lx - s.look.x) * (1 - Math.exp(-3 * dt));
    s.look.y += (ly - s.look.y) * (1 - Math.exp(-3 * dt));
    if (Math.abs(lx - s.look.x) > 1e-3 || Math.abs(ly - s.look.y) > 1e-3) moving = true;
    if (Math.abs(s.look.x) > 1e-4 || Math.abs(s.look.y) > 1e-4) {
      const [px, py, pz] = dest.position;
      const [tx, , tz] = dest.target;
      // The view's right, level: perpendicular to where it looks.
      const dx = tx - px;
      const dz = tz - pz;
      const len = Math.hypot(dx, dz) || 1;
      const rx = -dz / len;
      const rz = dx / len;
      dest = { ...dest, position: [px + rx * s.look.x * LOOK_X, py + s.look.y * LOOK_Y, pz + rz * s.look.x * LOOK_X] };
    }

    const shot = mixShot(s, dest, now);
    if (shot.moving) moving = true;
    const pose = shot.pose;
    applyPose(camera, pose);
    if (moving) invalidate();
  }, -1);

  return null;
}
