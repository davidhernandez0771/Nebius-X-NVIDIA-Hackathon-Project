// The Record page's teleop session: camera and hand tracking, the hand pose message and pinch
// latch, the link to the sim, the reset gesture, reach centering, Calibrate by hand, the debug
// trace, the hand-art cues and the hand lock (teleop/handLock.ts: one hand drives the arm, every
// other is ignored). Moved out of RecordPage.tsx unchanged, so the old page (/legacy/pm/record)
// and the new one (/record) run the same code; each only lays it out.
// The input switch (drive/drive.ts InputMode, saved locally): "camera" is all of the above; "keyboard" and "mouse"
// need no camera and no hand lock: a DriveSession (drive/driveSession.ts) makes the same HandPoseMsg and the same
// link sends it. The sim is told the input (set_input) when it connects and before each recording, so it smooths
// keyboard and mouse targets and saves the input with each demo.
// The camera path's message comes from teleop/handControl.ts (pinch-stable depth anchored across every gripper
// change, the view's left/right, sensitivity, the clutch); the page sends exactly the message it shows. In camera
// mode the clutch key (Shift by default) freezes the arm while held, and Space toggles the gripper when the gripper
// input is the spacebar. With "Save camera video" on (the default), camera mode records the webcam during each take and
// uploads it beside the demo the sim saves (cameraTake.ts: demos/<id>/camera.webm + camera.json).
// The soft floor (DriveSettings.softFloor, on by default, every input) goes to the sim as set_assist when it connects,
// before each recording and whenever it is toggled; the sim clamps the target and labels each demo with it.

import { useEffect, useRef, useState } from "react";
import type { HandFrame, TrackingAdapter, TrackingStatus } from "../hand/contracts";
import { loadFailureMessage } from "../hand/tracking/assets";
import {
  ReachCenterer,
  TeleopCalibrator,
  loadTeleopControl,
  palmCenter,
  saveTeleopControl,
  type CalibrationState,
  type TeleopControlSettings,
} from "./teleop/controlRegion";
import type { HandPoseMsg } from "./teleop/handPoseMessage";
import { HandControl } from "./teleop/handControl";
import { createResetGesture, type ResetGestureStatus } from "./teleop/resetGesture";
import { victoryScore } from "./teleop/victoryPose";
import { HandLock, type HandLockStatus } from "./teleop/handLock";
import { DebugTrace, traceFileName, traceFrame, type TraceSignals } from "./teleop/debugTrace";
import { latencyTraceRequested, type TeleopStatus } from "./teleop/teleopClient";
import { pmApi, teleopSocketUrl } from "../pm/api";
import { CameraTake, webmRecorder } from "./cameraTake";
import { controlFraming, framingCheck, type Framing } from "./framing";
import type { HandArtFrame } from "./handArt";
import { ArtCue } from "./artCue";
import { BreakthroughCue } from "./breakthroughCue";
import { RecordLink, type ControlAction, type SimStatus } from "./recordLink";
import { drawStage, type StagePalette } from "./stageDraw";
import { loadDriveSettings, saveDriveSettings, type DriveSettings, type InputMode } from "./drive/drive";
import { DriveSession, typingIn, type DriveUi } from "./drive/driveSession";

const UI_INTERVAL_MS = 100; // framing text updates at ~10 Hz; the canvas draws every frame
// Hand art (display only) changes style when something happens (ArtCue), crossfading; events
// closer together than the cooldown are dropped, and the crossfade ends before the next can start.
export const ART_MORPH_MS = 400;
export const ART_COOLDOWN_MS = 400;
const RESET_TOAST_MS = 2500; // how long "Reset fired" stays up after each fire (frame time)

export const SINK_COMMAND = "C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\teleop_sink.py --viz kit";
export const STEP_S = 0.02; // the sim records at 50 Hz (sim_worker/teleop_session.py TELEOP_DT)

export type Phase = { state: "idle" } | { state: "starting" } | { state: "streaming" } | { state: "error"; message: string };

/** Shown each time the reset gesture fires; `notSent` says why no reset_scene went out. */
export type ResetToast = { at: number; notSent: string | null };

/** A drive mode's pose: no hand, so framing is fine, no pinch, no reset gesture. */
function drivePose(u: DriveUi): PoseUi {
  return {
    msg: u.msg,
    framing: { state: "ok", hints: [] },
    gripper: u.gripper,
    pinch: null,
    victory: null,
    reset: { timestamp: u.msg.t_ms, phase: "idle", progress: 0, event: null },
    size3d: null,
    landmarks: null,
    fps: null,
  };
}

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
  /** The hand lock (handLock.ts): which hand drives the arm, or why none does. Always set by the
   *  session; optional so a PoseUi written before the lock still type-checks. */
  lock?: HandLockStatus;
};

function cameraMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked. Allow camera access for this site in the browser, then start again.";
  if (name === "NotFoundError") return "No camera found. Plug one in, then start again.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then start again.";
  return `The camera didn't start: ${loadFailureMessage(err)}`;
}

/** inputs: offer the keyboard and mouse (the /record page). Without it the session is camera only, whatever is saved. */
export function useRecordSession({ palette, inputs = false }: { palette?: StagePalette; inputs?: boolean } = {}) {
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
  const [drive, setDrive] = useState<DriveSettings>(() => (inputs ? loadDriveSettings() : { ...loadDriveSettings(), input: "camera" }));
  const [driveUi, setDriveUi] = useState<Omit<DriveUi, "msg"> | null>(null);
  const [mouseRefused, setMouseRefused] = useState<string | null>(null); // why the browser last refused Pointer Lock
  const driveRef = useRef(drive);
  const [clutch, setClutch] = useState(false); // camera mode: the clutch key is held, the arm's target is frozen
  const clutchRef = useRef(false);
  const spaceGripRef = useRef<0 | 1>(0); // camera mode with the spacebar gripper: its toggle state
  const resetToastAt = useRef<number | null>(null);
  const tracer = useRef<{ trace: DebugTrace; startedAt: Date } | null>(null);
  const traceUrl = useRef<string | null>(null); // the finished file's object URL, revoked when replaced
  const settingsRef = useRef(settings);
  const calibrator = useRef<TeleopCalibrator | null>(null);
  const centerer = useRef<ReachCenterer | null>(null);
  const calibrationStep = useRef<CalibrationState["step"] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<{ tracker: TrackingAdapter | null; link: RecordLink | null; drive: DriveSession | null; input: InputMode; keys?: () => void; video?: CameraTake } | null>(null);
  const simNow = useRef<SimStatus | null>(null); // the latest sim status, for the camera take's baseline demo id
  const [videoNote, setVideoNote] = useState<string | null>(null); // the last take's camera video: saved, or why not
  const handLockRef = useRef<HandLock | null>(null); // the running session's hand lock, for Re-pick
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
    handLockRef.current = null;
    artHand.current = null;
    calibrator.current = null;
    centerer.current = null;
    session.current?.video?.close(); // a take still open when the camera stops saves nothing
    session.current?.tracker?.cleanup();
    session.current?.drive?.stop();
    session.current?.keys?.();
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

  /** The input settings (input, speed, mouse sensitivity, the soft floor), saved locally. A new input stops the
   *  session: Start again in the new mode. The soft floor goes to the sim at once (set_assist), for every input. */
  function updateDrive(next: DriveSettings) {
    const switched = next.input !== driveRef.current.input;
    const prevFloor = driveRef.current.softFloor;
    driveRef.current = next;
    setDrive(next);
    saveDriveSettings(next);
    if (switched && session.current) stop();
    else if (next.softFloor !== prevFloor) session.current?.link?.sendAssist(next.softFloor);
  }

  /** The link to the sim, telling it the input whenever it (re)connects. */
  function openLink(input: InputMode): RecordLink {
    const link = new RecordLink(teleopSocketUrl(), WebSocket, { trace: latencyTraceRequested(window.location.search) });
    let simWas = false;
    link.onStatus((s) => {
      setRelay(s);
      if (s.simConnected && !simWas) {
        link.sendControl("set_input", input);
        link.sendAssist(driveRef.current.softFloor);
      }
      simWas = s.simConnected;
    });
    link.onSimStatus((status) => {
      simNow.current = status;
      setSim(status);
      session.current?.video?.sim(status);
    });
    return link;
  }

  /** Keyboard or mouse: no camera, no hand lock; the DriveSession's messages go through the same link. */
  function startDrive(input: InputMode) {
    const link = openLink(input);
    link.setControl(null);
    let lastUi: Omit<DriveUi, "msg"> | null = null;
    const driver = new DriveSession({
      send: (msg, grip) => link.send(msg, grip),
      ui: (u) => {
        const { msg, ...flags } = u;
        if (!lastUi || lastUi.gripper !== flags.gripper || lastUi.fine !== flags.fine || lastUi.locked !== flags.locked) setDriveUi(flags);
        lastUi = flags;
        setPose(drivePose({ msg, ...flags }));
      },
      enter: () => {
        if (simReadyNow.current) control(recordingNow.current ? "record_stop" : "record_start");
      },
      settings: () => driveRef.current,
    });
    session.current = { tracker: null, link, drive: driver, input };
    driver.start();
    setPhase({ state: "streaming" });
  }

  /** Camera mode's keys: the clutch key held freezes the arm (released: it carries on from the hand's new place);
   *  Space toggles the gripper when that is the gripper input. Keys typed into a field are left alone. */
  function cameraKeys(): () => void {
    const setHeld = (on: boolean) => {
      if (clutchRef.current === on) return;
      clutchRef.current = on;
      setClutch(on);
    };
    const down = (e: KeyboardEvent) => {
      const s = settingsRef.current;
      if (typingIn(e.target, e.code)) return;
      if (e.key === s.clutchKey) setHeld(true);
      else if (e.code === "Space" && s.gripperInput === "space") {
        e.preventDefault();
        if (!e.repeat) spaceGripRef.current = spaceGripRef.current ? 0 : 1;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === settingsRef.current.clutchKey) setHeld(false);
      if (e.code === "Space" && settingsRef.current.gripperInput === "space") e.preventDefault();
    };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    spaceGripRef.current = 0;
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      setHeld(false);
    };
  }

  /** Mouse mode: take Pointer Lock on this element (a click on the twin pane). The first click also starts the mouse
   *  session. A refusal is kept (mouseRefused) until the next click asks again. Call it inside the click's handler:
   *  the browser only locks the mouse for a user gesture. */
  function requestMouse(el: HTMLElement) {
    if (driveRef.current.input !== "mouse") return;
    if (!session.current) void start(); // keyboard and mouse start synchronously (startDrive), so the lock below can follow
    const driver = session.current?.drive;
    if (!driver) return;
    setMouseRefused(null);
    void driver.requestMouse(el).then((reason) => {
      if (session.current?.drive === driver) setMouseRefused(reason);
    });
  }

  async function start() {
    const input = driveRef.current.input;
    if (input !== "camera") {
      startDrive(input);
      return;
    }
    setPhase({ state: "starting" });
    const { createMediapipeTracker } = await import("../hand/tracking");
    const tracker = createMediapipeTracker();
    // Save camera video: the webcam is recorded with each take and uploaded beside the demo the sim saves (cameraTake.ts).
    const video = new CameraTake({
      stream: () => tracker.stream?.() ?? null,
      recorder: webmRecorder,
      upload: async (id, blob, timing) => void (await pmApi.saveCameraVideo(id, blob, timing)),
      report: setVideoNote,
      now: () => performance.now(),
    });
    session.current = { tracker, link: null, drive: null, input, keys: cameraKeys(), video };
    let lastUi = -Infinity;
    let framesSinceUi = 0; // for the fps readout (display only)
    const hands = new HandControl(); // pinch / spacebar gripper, depth, view, sensitivity, clutch (handControl.ts)
    const handLock = new HandLock(); // the one hand that drives the arm (handLock.ts)
    handLockRef.current = handLock;
    let lockPhase: HandLockStatus["phase"] | null = null;
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
      // The hand lock: only the locked hand (or, for up to 0.7 s, a held copy of it) reaches anything below;
      // every other hand in the frame is dropped here. `held`: this frame repeats the last pose.
      const { hand, status: lock } = handLock.update(frame);
      const held = lock.held !== null;
      // The message the link sends, so what the page shows is what the sim gets. The gripper: thumb tip and index
      // tip together = closed (or the spacebar); a held frame is no new evidence, so it stays as it was.
      const out = hands.step(hand, frame, s, { clutch: clutchRef.current, spaceGripper: spaceGripRef.current }, held);
      const { msg, pinch, gripper } = out;
      session.current?.link?.send(msg, gripper);
      video.frame(msg.t_ms, [frame.frameWidth, frame.frameHeight]); // kept only while a take records
      // Reset gesture: the V sign held 1.5 s, gripper open, hand still -> the Reset scene control.
      const victory = msg.tracking_ok && hand && !held ? victoryScore(hand, frame.frameWidth, frame.frameHeight).score : null;
      resetGesture ??= createResetGesture({ aspect: frame.frameWidth / frame.frameHeight });
      const reset = resetGesture.update({
        timestamp: frame.timestamp,
        victory,
        gripperOpen: gripper === 0,
        position: msg.tracking_ok && hand && !held ? palmCenter(hand.landmarks) : null,
      });
      if (reset.event === "fire") {
        if (canReset.current) control("reset_scene");
        // The reset gesture also re-picks the hand (not while recording): the next hand held still 0.3 s locks.
        if (!recordingNow.current) handLock.reset();
        const notSent = canReset.current ? null : simReadyNow.current ? "stop recording first" : "the sim isn't connected";
        resetToastAt.current = frame.timestamp;
        setResetToast({ at: frame.timestamp, notSent });
      } else if (resetToastAt.current !== null && frame.timestamp - resetToastAt.current > RESET_TOAST_MS) {
        resetToastAt.current = null;
        setResetToast(null);
      }
      // Reach: the pinch-stable size (or the 3D size with 3D reach on), anchored across gripper changes (depthSignal.ts).
      const size3d = msg.tracking_ok ? out.size3d : null;
      const reachSize = out.reachSize;
      if (centerer.current) recenter(centerer.current, frame.timestamp, held ? null : reachSize);
      const tracked = hand && reachSize !== null ? { center: palmCenter(hand.landmarks), palmWidth: reachSize } : null;
      const framing = s.enabled ? controlFraming(tracked, s) : framingCheck(msg);
      // Display only: the overlay reads this; nothing flows back into the message or the gripper.
      const crossing = breakthrough.update(msg.tracking_ok ? msg.control?.[2] ?? null : null);
      artHand.current = {
        landmarks: hand?.landmarks ?? null,
        gripperClosed: gripper === 1,
        cue: cue.update({ gripper, recording: recordingNow.current, resets: resets.current, breakthrough: crossing.count }),
      };
      if (canvas.current) drawStage(canvas.current, hand, framing, s, gripper, s.showHandArt && artActive.current, paletteRef.current, lock);
      framesSinceUi++;
      const uiTick = frame.timestamp - lastUi >= UI_INTERVAL_MS;
      if (calibrator.current) calibrate(calibrator.current, frame.timestamp, held ? null : tracked, uiTick);
      if (tracer.current) {
        const signals: TraceSignals = {
          pinch,
          gripper,
          victory,
          size3d,
          reachSize,
          stable: msg.tracking_ok ? out.stable : null,
          clutch: clutchRef.current,
          reach3d: s.reach3d,
          breakthrough: crossing.count,
          breakthroughDir: crossing.dir,
          lock,
        };
        traceStep(tracer.current, traceFrame(frame, hand, msg, signals), uiTick);
      }
      const lockChanged = lock.phase !== lockPhase;
      lockPhase = lock.phase;
      if (uiTick || reset.event || lockChanged) {
        const elapsed = frame.timestamp - lastUi;
        // framesSinceUi frames (intervals) arrived since the last update, this one included.
        const fps = Number.isFinite(elapsed) && elapsed > 0 ? (framesSinceUi * 1000) / elapsed : null;
        lastUi = frame.timestamp;
        framesSinceUi = 0;
        const landmarks = msg.tracking_ok && hand ? hand.landmarks.map((p) => [p.x, p.y] as const) : null;
        setPose({ msg, framing, gripper, pinch, victory, reset, size3d, landmarks, fps, lock });
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
    const link = openLink("camera");
    link.setControl(settingsRef.current.enabled ? settingsRef.current : null);
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
    setDriveUi(null);
    setMouseRefused(null);
    setVideoNote(null);
    simNow.current = null;
    resetToastAt.current = null;
    setResetToast(null);
    setPhase({ state: "idle" });
  }

  /** Re-pick the hand: drop the lock; the next hand held still for 0.3 s drives the arm. */
  function repickHand() {
    handLockRef.current?.reset();
  }

  function control(action: ControlAction) {
    const s = session.current;
    if (action === "reset_scene") {
      resets.current++;
      s?.drive?.reset(); // the target goes home with the robot
    }
    // Before each recording, the input again: the demo is saved with it even if the sim restarted meanwhile.
    if (action === "record_start" && s) {
      s.link?.sendControl("set_input", s.input);
      s.link?.sendAssist(driveRef.current.softFloor); // and the soft floor, so the demo is labelled with it
    }
    const wasRecording = recordingNow.current;
    const sent = s?.link?.sendControl(action);
    // Camera mode: the take's webcam video follows the recording (saved with the demo, or dropped with a discard).
    if (sent && s?.video) {
      if (action === "record_start" && !wasRecording && settingsRef.current.saveVideo) {
        setVideoNote("recording camera video");
        s.video.begin(simNow.current?.demoId ?? null);
      } else if (action === "record_stop") s.video.end();
      else if (action === "record_discard") {
        s.video.discard();
        setVideoNote("camera video discarded with the take");
      }
    }
    return sent;
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
    clutch,
    drive,
    driveUi,
    mouseRefused,
    videoNote,
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
    repickHand,
    updateDrive,
    requestMouse,
  };
}

export type RecordSession = ReturnType<typeof useRecordSession>;
