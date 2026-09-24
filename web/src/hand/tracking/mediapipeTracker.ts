// MediaPipe HandLandmarker-backed TrackingAdapter (Agent 1).
//
// Emits raw, unmirrored HandFrames at animation-frame rate and runs an
// independent watchdog so a silently-stalled pipeline (backgrounded tab,
// unplugged camera, wedged worker) is still caught -- see STALE_FRAME_MS in
// contracts.ts.

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame, TrackingAdapter, TrackingStatus } from "../contracts";
import { STALE_FRAME_MS } from "../contracts";
import { startCamera, type CameraHandle } from "./camera";
import { buildTrackedHands } from "./handFrameBuilder";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/models/hand_landmarker.task";
const WATCHDOG_INTERVAL_MS = 100;

export function createMediapipeTracker(): TrackingAdapter {
  let camera: CameraHandle | null = null;
  let landmarker: HandLandmarker | null = null;
  let rafId: number | null = null;
  let watchdogId: number | null = null;
  let lastFrameAt = 0;
  let status: TrackingStatus = "idle";
  let starting = false;
  let cleanedUp = false;

  const frameListeners = new Set<(frame: HandFrame) => void>();
  const statusListeners = new Set<(status: TrackingStatus) => void>();

  function setStatus(next: TrackingStatus) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((cb) => cb(next));
  }

  function emitFrame(frame: HandFrame) {
    lastFrameAt = frame.timestamp;
    frameListeners.forEach((cb) => cb(frame));
  }

  function detectTick() {
    if (!landmarker || !camera) return;
    const video = camera.video;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const timestamp = performance.now();
      const result = landmarker.detectForVideo(video, timestamp);
      const hands = buildTrackedHands(result.landmarks, result.handedness);

      emitFrame({
        timestamp,
        hands,
        frameWidth: video.videoWidth,
        frameHeight: video.videoHeight,
      });
      setStatus(hands.length > 0 ? "tracking" : "no-hand");
    }

    rafId = requestAnimationFrame(detectTick);
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogId = window.setInterval(() => {
      if (performance.now() - lastFrameAt >= STALE_FRAME_MS) {
        setStatus("error");
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (watchdogId !== null) {
      window.clearInterval(watchdogId);
      watchdogId = null;
    }
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    stopWatchdog();
  }

  return {
    async start() {
      if (cleanedUp) {
        throw new Error("MediapipeTracker: start() called after cleanup()");
      }
      if (starting || rafId !== null) return;
      starting = true;
      setStatus("loading");

      try {
        // cleanup() can run while any of the awaits below are in flight
        // (e.g. the user disables hand control while a camera permission
        // prompt is still unanswered). Check `cleanedUp` after each await
        // and release whatever was just acquired instead of assigning it --
        // otherwise a camera stream that arrives after cleanup() would never
        // be stopped, leaking a live camera after the user opted out.
        if (!camera) {
          const acquired = await startCamera();
          if (cleanedUp) {
            acquired.stop();
            return;
          }
          camera = acquired;
        }
        if (!landmarker) {
          const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
          if (cleanedUp) return;
          const acquiredLandmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_ASSET_PATH,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numHands: 2,
            // Previously unset (library default 0.5 for all three). Raising
            // detection/presence reduces "cursor snaps to a phantom
            // position" from low-confidence hand locks; tracking confidence
            // stays more permissive so an already-locked-on hand isn't
            // dropped mid-gesture from minor motion blur. Reasoned defaults,
            // not tuned against a real camera -- sanity-check by feel.
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.5,
          });
          if (cleanedUp) {
            acquiredLandmarker.close();
            return;
          }
          landmarker = acquiredLandmarker;
        }
        if (cleanedUp) return;

        lastFrameAt = performance.now();
        startWatchdog();
        rafId = requestAnimationFrame(detectTick);
      } catch (err) {
        if (!cleanedUp) {
          stopLoop();
          setStatus("error");
        }
        throw err;
      } finally {
        starting = false;
      }
    },

    stop() {
      stopLoop();
      setStatus("idle");
    },

    cleanup() {
      stopLoop();
      camera?.stop();
      camera = null;
      landmarker?.close();
      landmarker = null;
      cleanedUp = true;
      setStatus("idle");
      frameListeners.clear();
      statusListeners.clear();
    },

    onFrame(cb) {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },

    onStatus(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
  };
}
