// The Record page's teleop session: camera and hand tracking, the hand pose message and pinch
// latch, the link to the sim, the reset gesture, reach centering, Calibrate by hand, the debug
// trace and the hand-art cues. Moved out of RecordPage.tsx unchanged, so the old page
// (/legacy/pm/record) and the new one (/record) run the same code; each only lays it out.

import { useEffect, useRef, useState } from "react";
import type { HandFrame, TrackedHand, TrackingAdapter, TrackingStatus } from "../hand/contracts";
import {
  ReachCenterer,
  TeleopCalibrator,
  loadTeleopControl,
  palmCenter,
  saveTeleopControl,
  type CalibrationState,
  type TeleopControlSettings,
} from "./teleop/controlRegion";
import { toHandPoseMsg, type HandPoseMsg } from "./teleop/handPoseMessage";
import { PinchLatch, pinchGap } from "./teleop/pinch";
import { createResetGesture, type ResetGestureStatus } from "./teleop/resetGesture";
import { victoryScore } from "./teleop/victoryPose";
import { reachSize3d } from "./teleop/reach3d";
import { DebugTrace, traceFileName, traceFrame, type TraceSignals } from "./teleop/debugTrace";
import { latencyTraceRequested, type TeleopStatus } from "./teleop/teleopClient";
import { teleopSocketUrl } from "../pm/api";
import { controlFraming, framingCheck, type Framing } from "./framing";
import type { HandArtFrame } from "./handArt";
import { ArtCue } from "./artCue";
import { BreakthroughCue } from "./breakthroughCue";
import { RecordLink, type ControlAction, type SimStatus } from "./recordLink";
import { drawStage, type StagePalette } from "./stageDraw";

const UI_INTERVAL_MS = 100; // framing text updates at ~10 Hz; the canvas draws every frame
// Hand art (display only) changes style when something happens (ArtCue), crossfading; events
// closer together than the cooldown are dropped, and the crossfade ends before the next can start.
export const ART_MORPH_MS = 400;
export const ART_COOLDOWN_MS = 400;
const RESET_TOAST_MS = 2500; // how long "Reset fired" stays up after each fire (frame time)

export const SINK_COMMAND = "C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\teleop_sink.py --viz kit";
export const STEP_S = 0.02; // the sim records at 50 Hz (sim_worker/teleop_session.py TELEOP_DT)

// Same choice as TeleopClient: the right hand, else the first one.
const pickHand = (hands: TrackedHand[]) => hands.find((h) => h.handedness === "Right") ?? hands[0] ?? null;

export type Phase = { state: "idle" } | { state: "starting" } | { state: "streaming" } | { state: "error"; message: string };

/** Shown each time the reset gesture fires; `notSent` says why no reset_scene went out. */
export type ResetToast = { at: number; notSent: string | null };

export type TraceUi = { state: "recording"; progress: number } | { state: "done"; url: string; name: string; frames: number };

/** What the page shows of the latest frame, refreshed at ~10 Hz (and on each reset-gesture event). */
export type PoseUi = {
  msg: HandPoseMsg;
  framing: Framing;
  gripper: 0 | 1;
  pinch: number | null; // the pinch gap (pinch.ts)
  victory: number | null;
  reset: ResetGestureStatus;
  size3d: number | null; // the 3D reach signal, shown next to the palm width either way
  /** The tracked hand's landmarks in raw camera coordinates (display only); null without a hand. */
  landmarks: readonly (readonly [number, number])[] | null;
  /** Camera frames per second since the last update (display only); null on the first one. */
  fps?: number | null;
};

function cameraMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked. Allow camera access for this site in the browser, then start again.";
  if (name === "NotFoundError") return "No camera found. Plug one in, then start again.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then start again.";
  return `The camera didn't start: ${err instanceof Error ? err.message : String(err)}`;
}

export function useRecordSession({ palette }: { palette?: StagePalette } = {}) {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [track, setTrack] = useState<TrackingStatus>("idle");
  const [relay, setRelay] = useState<TeleopStatus>({ socketOpen: false, simConnected: false, lastError: null });
  const [sim, setSim] = useState<SimStatus | null>(null);
  const [pose, setPose] = useState<PoseUi | null>(null);
  const [settings, setSettings] = useState<TeleopControlSettings>(loadTeleopControl);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [recentering, setRecentering] = useState(false);
  const [trace, setTrace] = useState<TraceUi | null>(null);
  const [resetToast, setResetToast] = useState<ResetToast | null>(null);
  const resetToastAt = useRef<number | null>(null);
  const tracer = useRef<{ trace: DebugTrace; startedAt: Date } | null>(null);
  const traceUrl = useRef<string | null>(null); // the finished file's object URL, revoked when replaced
  const settingsRef = useRef(settings);
  const calibrator = useRef<TeleopCalibrator | null>(null);
  const centerer = useRef<ReachCenterer | null>(null);
  const calibrationStep = useRef<CalibrationState["step"] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<{ tracker: TrackingAdapter; link: RecordLink | null } | null>(null);
  const artHand = useRef<HandArtFrame | null>(null); // polled by the hand-art overlay each animation frame
  const artActive = useRef(false); // the overlay is drawing (WebGL up)
  const resets = useRef(0); // Reset scene presses, for the hand-art cue
  const recordingNow = useRef(false); // the sim is recording, for the hand-art cue
  const canReset = useRef(false); // sim connected and not recording, like the Reset scene button
  const simReadyNow = useRef(false); // sim connected, for the toast's "not sent" reason
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  function updateSettings(next: TeleopControlSettings) {
    const switchedReach = next.reach3d !== settingsRef.current.reach3d;
    settingsRef.current = next;
    setSettings(next);
    saveTeleopControl(next);
    session.current?.link?.setControl(next.enabled ? next : null);
    // A new reach signal: center its range on the hand again, so the natural distance stays the cube's row.
    if (switchedReach && next.depthAuto && session.current) startRecenter();
  }

  function teardown() {
    tracer.current = null;
    artHand.current = null;
    calibrator.current = null;
    centerer.current = null;
    session.current?.tracker.cleanup();
    session.current?.link?.close();
    session.current = null;
  }
  useEffect(() => teardown, []);
  useEffect(
    () => () => {
      if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
    },
    [],
  );

  async function start() {
    setPhase({ state: "starting" });
    const { createMediapipeTracker } = await import("../hand/tracking");
    const tracker = createMediapipeTracker();
    session.current = { tracker, link: null };
    let lastUi = -Infinity;
    let framesSinceUi = 0; // for the fps readout (display only)
    let last: HandPoseMsg | undefined;
    const latch = new PinchLatch(); // the gripper: closes at once, opens after a wide gap held 150 ms
    const cue = new ArtCue();
    const breakthrough = new BreakthroughCue(); // reach crossing the cube's row in depth
    let resetGesture: ReturnType<typeof createResetGesture> | null = null; // made on the first frame (aspect)
    // Auto-centered reach: unless the depth range was calibrated or set by hand, center it on the
    // hand's natural distance once tracking starts (ReachCenterer: ~1 s of palm widths).
    centerer.current = settingsRef.current.depthAuto ? new ReachCenterer() : null;
    setRecentering(centerer.current !== null);
    tracker.onStatus(setTrack);
    tracker.onFrame((frame: HandFrame) => {
      const s = settingsRef.current;
      const hand = pickHand(frame.hands);
      // The same message the link sends, so what the page shows is what the sim gets.
      const msg = toHandPoseMsg(hand, frame, last, s);
      last = msg;
      // The gripper: thumb tip and index tip together = closed; the link sends it as HandPoseMsg.grip.
      const pinch = msg.tracking_ok && hand ? pinchGap(hand.landmarks, frame.frameWidth, frame.frameHeight) : null;
      const gripper = latch.update(pinch, frame.timestamp);
      session.current?.link?.push(frame, gripper);
      // Reset gesture: the V sign held 1.5 s, gripper open, hand still -> the Reset scene control.
      const victory = msg.tracking_ok && hand ? victoryScore(hand, frame.frameWidth, frame.frameHeight).score : null;
      resetGesture ??= createResetGesture({ aspect: frame.frameWidth / frame.frameHeight });
      const reset = resetGesture.update({
        timestamp: frame.timestamp,
        victory,
        gripperOpen: gripper === 0,
        position: msg.tracking_ok && hand ? palmCenter(hand.landmarks) : null,
      });
      if (reset.event === "fire") {
        if (canReset.current) control("reset_scene");
        const notSent = canReset.current ? null : simReadyNow.current ? "stop recording first" : "the sim isn't connected";
        resetToastAt.current = frame.timestamp;
        setResetToast({ at: frame.timestamp, notSent });
      } else if (resetToastAt.current !== null && frame.timestamp - resetToastAt.current > RESET_TOAST_MS) {
        resetToastAt.current = null;
        setResetToast(null);
      }
      // Reach is computed from the palm width, or the 3D size with 3D reach on (falling back per frame).
      const size3d = msg.tracking_ok && hand ? reachSize3d(hand, frame.frameWidth, frame.frameHeight) : null;
      const reachSize = msg.tracking_ok ? (s.reach3d && size3d) || msg.palm_width : null;
      if (centerer.current) recenter(centerer.current, frame.timestamp, reachSize);
      const tracked = hand && reachSize !== null ? { center: palmCenter(hand.landmarks), palmWidth: reachSize } : null;
      const framing = s.enabled ? controlFraming(tracked, s) : framingCheck(msg);
      // Display only: the overlay reads this; nothing flows back into the message or the gripper.
      const crossing = breakthrough.update(msg.tracking_ok ? msg.control?.[2] ?? null : null);
      artHand.current = {
        landmarks: hand?.landmarks ?? null,
        gripperClosed: gripper === 1,
        cue: cue.update({ gripper, recording: recordingNow.current, resets: resets.current, breakthrough: crossing.count }),
      };
      if (canvas.current) drawStage(canvas.current, hand, framing, s, gripper, s.showHandArt && artActive.current, paletteRef.current);
      framesSinceUi++;
      const uiTick = frame.timestamp - lastUi >= UI_INTERVAL_MS;
      if (calibrator.current) calibrate(calibrator.current, frame.timestamp, tracked, uiTick);
      if (tracer.current) {
        const signals: TraceSignals = {
          pinch,
          gripper,
          victory,
          size3d,
          reachSize,
          reach3d: s.reach3d,
          breakthrough: crossing.count,
          breakthroughDir: crossing.dir,
        };
        traceStep(tracer.current, traceFrame(frame, hand, msg, signals), uiTick);
      }
      if (uiTick || reset.event) {
        const elapsed = frame.timestamp - lastUi;
        // framesSinceUi frames (intervals) arrived since the last update, this one included.
        const fps = Number.isFinite(elapsed) && elapsed > 0 ? (framesSinceUi * 1000) / elapsed : null;
        lastUi = frame.timestamp;
        framesSinceUi = 0;
        const landmarks = msg.tracking_ok && hand ? hand.landmarks.map((p) => [p.x, p.y] as const) : null;
        setPose({ msg, framing, gripper, pinch, victory, reset, size3d, landmarks, fps });
      }
    });
    try {
      await tracker.start();
    } catch (e) {
      teardown();
      setPhase({ state: "error", message: cameraMessage(e) });
      return;
    }
    // Open the relay only once the camera works, so a blocked camera never streams.
    const link = new RecordLink(teleopSocketUrl(), WebSocket, { trace: latencyTraceRequested(window.location.search) });
    link.setControl(settingsRef.current.enabled ? settingsRef.current : null);
    link.onStatus(setRelay);
    link.onSimStatus(setSim);
    if (session.current) session.current.link = link;
    setPhase({ state: "streaming" });
  }

  type Tracked = { center: { x: number; y: number }; palmWidth: number } | null;

  /** One frame of reach centering; the result applies (and saves) at once. */
  function recenter(c: ReachCenterer, t: number, size: number | null) {
    const reach = c.push(t, size);
    if (!reach) return;
    centerer.current = null;
    setRecentering(false);
    updateSettings({ ...settingsRef.current, ...reach, depthAuto: true });
  }

  function startRecenter() {
    calibrator.current = null; // the two would fight over the depth range
    setCalibration(null);
    centerer.current = new ReachCenterer();
    setRecentering(true);
  }

  /** One frame of Calibrate by hand; a finished calibration is applied (and saved) at once. */
  function calibrate(cal: TeleopCalibrator, t: number, tracked: Tracked, uiTick: boolean) {
    const state = cal.push({ t, center: tracked?.center ?? null, palmWidth: tracked?.palmWidth ?? 0 });
    const finished = state.step === "done" || state.step === "failed";
    if (finished) calibrator.current = null;
    if (state.step === "done" && state.result)
      updateSettings({ ...settingsRef.current, enabled: true, ...state.result, depthAuto: false });
    if (uiTick || finished || state.step !== calibrationStep.current) {
      calibrationStep.current = state.step;
      setCalibration(state);
    }
  }

  function startCalibration() {
    centerer.current = null;
    setRecentering(false);
    calibrator.current = new TeleopCalibrator();
    calibrationStep.current = "move";
    setCalibration({ step: "move", progress: 0 });
  }

  function cancelCalibration() {
    calibrator.current = null;
    setCalibration(null);
  }

  /** One frame of Record debug trace; when it is full, the JSON file is offered for download. */
  function traceStep(rec: { trace: DebugTrace; startedAt: Date }, entry: ReturnType<typeof traceFrame>, uiTick: boolean) {
    const state = rec.trace.push(entry);
    if (!state.done) {
      if (uiTick) setTrace({ state: "recording", progress: state.progress });
      return;
    }
    tracer.current = null;
    const file = rec.trace.toJSON({ settings: settingsRef.current, startedAt: rec.startedAt.toISOString() });
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    traceUrl.current = url;
    setTrace({ state: "done", url, name: traceFileName(rec.startedAt), frames: state.frames });
  }

  function startTrace() {
    if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
    traceUrl.current = null;
    tracer.current = { trace: new DebugTrace(), startedAt: new Date() };
    setTrace({ state: "recording", progress: 0 });
  }

  function stop() {
    teardown();
    setCalibration(null);
    setTrace((t) => (t?.state === "recording" ? null : t)); // a finished file stays downloadable
    setRecentering(false);
    setTrack("idle");
    setRelay({ socketOpen: false, simConnected: false, lastError: null });
    setSim(null);
    setPose(null);
    resetToastAt.current = null;
    setResetToast(null);
    setPhase({ state: "idle" });
  }

  function control(action: ControlAction) {
    if (action === "reset_scene") resets.current++;
    return session.current?.link?.sendControl(action);
  }

  const streaming = phase.state === "streaming";
  const lost = streaming && (track === "no-hand" || track === "error");
  const simReady = streaming && relay.simConnected;
  const recording = simReady && !!sim?.recording;
  canReset.current = simReady && !recording;
  simReadyNow.current = simReady;
  recordingNow.current = recording;

  return {
    phase,
    track,
    relay,
    sim,
    pose,
    settings,
    calibration,
    recentering,
    trace,
    resetToast,
    streaming,
    lost,
    simReady,
    recording,
    /** The stage canvas; the session draws into it every frame. */
    canvas,
    /** Polled by the hand-art overlay each animation frame. */
    artHand,
    /** Set by the hand-art overlay's onActiveChange. */
    artActive,
    start,
    stop,
    control,
    updateSettings,
    startRecenter,
    startCalibration,
    cancelCalibration,
    startTrace,
  };
}

export type RecordSession = ReturnType<typeof useRecordSession>;
