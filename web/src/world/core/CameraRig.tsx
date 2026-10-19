// Moves the one camera. Full motion: follows the rail at the scroll position, damped so wheel steps
// glide, and tweens to and from a branch. Reduced motion: no travel at all; it cuts between the
// stations' rest poses behind a short fade (the veil). It asks for a frame only while moving.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { mixPose, poseAt, reducedPoseAt, restPose, smoother } from "./rail";
import type { WorldStore } from "./store";
import type { CameraPose, StationModule } from "./types";

const DAMP = 7;
const SETTLE_PX = 0.5;
const TWEEN_S = 1.1;
/** Half the veil: the cut happens while it is fully up. Matches .world-veil.is-cut in world.css. */
export const CUT_S = 0.16;

interface RigState {
  shown: number;
  key: string | null;
  pose: CameraPose | null;
  tween: { from: CameraPose; start: number } | null;
  cutAt: number | null;
}

export function applyPose(camera: PerspectiveCamera, p: CameraPose): void {
  camera.position.set(p.position[0], p.position[1], p.position[2]);
  camera.lookAt(p.target[0], p.target[1], p.target[2]);
  if (camera.fov !== p.fov) {
    camera.fov = p.fov;
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
  const st = useRef<RigState>({ shown: store.targetY, key: null, pose: null, tween: null, cutAt: null });

  useEffect(() => store.onTarget(() => invalidate()), [store, invalidate]);
  useEffect(() => invalidate(), [reduced, invalidate]);

  // Priority -1: before every station's useFrame, so they read this frame's StationFrame.
  useFrame((state, delta) => {
    const s = st.current;
    const now = state.clock.elapsedTime;
    // After an idle stretch the first delta is the whole idle time: clamp it, or the damping jumps.
    const dt = Math.min(delta, 1 / 30);
    let moving = false;

    const target = store.targetY;
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
    if (open) {
      dest = restPose(open);
      key = open.id;
    } else if (override) {
      dest = override;
      // A new shot (the tour's next stop) tweens again.
      key = `override:${override.position.join(",")}`;
    } else if (reduced) {
      const r = reducedPoseAt(store.rails, store.rail, s.shown);
      dest = r.pose;
      key = store.rails[r.index].id;
    } else {
      dest = poseAt(store.rails, store.rail, s.shown);
      key = "rail";
    }

    if (s.pose === null) {
      s.pose = dest;
      s.key = key;
    } else if (key !== s.key) {
      s.key = key;
      if (reduced) {
        s.cutAt = now + CUT_S;
        s.tween = null;
        onCut();
      } else {
        s.tween = { from: s.pose, start: now };
        s.cutAt = null;
      }
    }

    let pose = dest;
    if (s.cutAt !== null) {
      if (now < s.cutAt) {
        pose = s.pose;
        moving = true;
      } else s.cutAt = null;
    } else if (s.tween) {
      const u = (now - s.tween.start) / TWEEN_S;
      if (u < 1) {
        pose = mixPose(s.tween.from, dest, smoother(u));
        moving = true;
      } else s.tween = null;
    }
    s.pose = pose;
    applyPose(camera, pose);
    if (moving) invalidate();
  }, -1);

  return null;
}
