// Reset gesture for webcam teleop: Victory (two fingers up) held for 1.5 s resets the scene.
//
// Pure and frame-driven: the caller feeds one sample per tracked frame and reads a status back
// (phase, progress 0..1 for the ring, and a one-frame event). Nothing here touches the DOM, the
// camera or the sim; T4's Record wiring sends the existing `reset_scene` control on "fire".
//
// Rules (sprint 8 plan + hand-teleop research, "Reset gesture"):
// - A frame is a HIT when the Victory score is >= minScore (0.85; 0.7 until live test #7, where a
//   resting hand scoring near 0.7 fired it). Hand v3: the score comes from our own classifier over
//   HandLandmarker landmarks (victoryPose.ts), not GestureRecognizer.
// - A hold STARTS on a hit frame with the gripper open and a known hand position.
// - It FIRES when holdMs (1.5 s) has passed since the start, on a hit frame, provided it was
//   never cancelled on the way. Progress is time-based: (now - start) / holdMs.
// - It CANCELS (progress back to 0) on the first frame where any of these is true:
//     "gripper":   the gripper is closed;
//     "moved":     the hand drifted more than maxDrift from where the hold started;
//     "dropped":   no hit frame for longer than dropGraceMs (a lost hand counts as a miss);
//     "low-score": fewer than minHitFraction (80%) of the hold's frames were hits. Checked on hit
//                  frames once the hold has minSamplesForFraction frames, so one early miss can't
//                  cancel it and a continuous gap is reported as "dropped". The firing frame is a
//                  hit frame, so it is always checked.
// - After firing: a COOLDOWN of cooldownMs, and the gesture must also be released (no hit frame
//   for releaseMs, during or after the cooldown) before a new hold can start, so a Victory that
//   is simply kept up never resets the scene twice. Live test #7: with one non-hit frame as the
//   release, tracking noise re-armed a kept-up V and it fired every ~3.5 s.

export interface ResetGestureSample {
  /** Monotonic ms (HandFrame.timestamp). A sample that doesn't increase is ignored. */
  timestamp: number;
  /** The primary hand's Victory score, 0..1 (victoryPose.ts); null/undefined with no hand. */
  victory: number | null | undefined;
  /** The grasp state the arm is using: true = open. */
  gripperOpen: boolean;
  /**
   * Where the hand is, in raw image-normalized coordinates (e.g. teleop's palmCenter()).
   * null when no hand is tracked. Used only for the stillness check.
   */
  position: { x: number; y: number } | null;
}

export type ResetGesturePhase = "idle" | "holding" | "cooldown";
export type ResetGestureEvent = "start" | "cancel" | "fire";
export type ResetGestureCancelReason = "gripper" | "moved" | "dropped" | "low-score";

export interface ResetGestureStatus {
  timestamp: number;
  phase: ResetGesturePhase;
  /** 0..1 while holding; 1 on the "fire" frame; 0 otherwise. */
  progress: number;
  /** Set on the one frame where it happened, otherwise null. */
  event: ResetGestureEvent | null;
  cancelReason?: ResetGestureCancelReason;
}

export interface ResetGestureOptions {
  holdMs: number;
  minScore: number;
  minHitFraction: number;
  minSamplesForFraction: number;
  dropGraceMs: number;
  /** Max distance from the start position, in frame-HEIGHT units (x is scaled by `aspect`). */
  maxDrift: number;
  /** frameWidth / frameHeight, so drift is aspect-correct; 1 treats x and y alike. */
  aspect: number;
  cooldownMs: number;
  /** No hit frame for this long releases the gesture after a fire. */
  releaseMs: number;
}

export const DEFAULT_RESET_GESTURE_OPTIONS: ResetGestureOptions = {
  holdMs: 1500,
  minScore: 0.85,
  minHitFraction: 0.8,
  minSamplesForFraction: 6, // ~0.2 s at 30 fps
  dropGraceMs: 250,
  maxDrift: 0.06,
  aspect: 1,
  cooldownMs: 2000,
  releaseMs: 500,
};

export interface ResetGesture {
  update(sample: ResetGestureSample): ResetGestureStatus;
  /** Back to idle: no hold, no cooldown, armed. */
  reset(): void;
}

export function createResetGesture(options: Partial<ResetGestureOptions> = {}): ResetGesture {
  const o: ResetGestureOptions = { ...DEFAULT_RESET_GESTURE_OPTIONS, ...options };

  let phase: ResetGesturePhase = "idle";
  let lastTs: number | null = null;
  let last: ResetGestureStatus = { timestamp: 0, phase: "idle", progress: 0, event: null };
  let released = true; // no hit for releaseMs since the last fire
  let lastHitTs = -Infinity; // the latest hit frame, for the release
  let holdStart = 0;
  let anchor = { x: 0, y: 0 };
  let lastHitAt = 0;
  let hits = 0;
  let total = 0;
  let firedAt = 0;

  const isHit = (s: ResetGestureSample): boolean => typeof s.victory === "number" && s.victory >= o.minScore;

  function emit(status: ResetGestureStatus): ResetGestureStatus {
    last = status;
    return status;
  }

  function cancel(t: number, reason: ResetGestureCancelReason): ResetGestureStatus {
    phase = "idle";
    return emit({ timestamp: t, phase, progress: 0, event: "cancel", cancelReason: reason });
  }

  function drift(p: { x: number; y: number }): number {
    return Math.hypot((p.x - anchor.x) * o.aspect, p.y - anchor.y);
  }

  return {
    update(s) {
      const t = s.timestamp;
      if (lastTs !== null && !(t > lastTs)) return { ...last, event: null, cancelReason: undefined };
      lastTs = t;
      const hit = isHit(s);
      if (hit) lastHitTs = t;
      else if (t - lastHitTs >= o.releaseMs) released = true;

      if (phase === "cooldown") {
        if (t - firedAt < o.cooldownMs) return emit({ timestamp: t, phase, progress: 0, event: null });
        phase = "idle";
      }

      if (phase === "idle") {
        if (hit && released && s.gripperOpen && s.position) {
          phase = "holding";
          holdStart = t;
          anchor = { ...s.position };
          lastHitAt = t;
          hits = 1;
          total = 1;
          return emit({ timestamp: t, phase, progress: 0, event: "start" });
        }
        return emit({ timestamp: t, phase, progress: 0, event: null });
      }

      // holding
      total += 1;
      if (hit) {
        hits += 1;
        lastHitAt = t;
      }
      if (!s.gripperOpen) return cancel(t, "gripper");
      if (s.position && drift(s.position) > o.maxDrift) return cancel(t, "moved");
      if (t - lastHitAt > o.dropGraceMs) return cancel(t, "dropped");
      if (hit && total >= o.minSamplesForFraction && hits / total < o.minHitFraction) return cancel(t, "low-score");

      const progress = Math.min(1, (t - holdStart) / o.holdMs);
      if (progress >= 1 && hit) {
        phase = "cooldown";
        firedAt = t;
        released = false;
        return emit({ timestamp: t, phase, progress: 1, event: "fire" });
      }
      return emit({ timestamp: t, phase, progress, event: null });
    },

    reset() {
      phase = "idle";
      lastTs = null;
      released = true;
      lastHitTs = -Infinity;
      last = { timestamp: 0, phase: "idle", progress: 0, event: null };
    },
  };
}
