import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GlassCard, StatusPill, Zones } from "../../components";
import type { HandFrame, TrackedHand, TrackingAdapter, TrackingStatus } from "../../hand/contracts";
import {
  ReachCenterer,
  TeleopCalibrator,
  loadTeleopControl,
  palmCenter,
  saveTeleopControl,
  type CalibrationState,
  type TeleopControlSettings,
} from "../../teleop/controlRegion";
import { toHandPoseMsg, type HandPoseMsg } from "../../teleop/handPoseMessage";
import { PinchLatch, pinchGap } from "../../teleop/pinch";
import { createResetGesture, type ResetGestureStatus } from "../../teleop/resetGesture";
import { victoryScore } from "../../teleop/victoryPose";
import { reachSize3d } from "../../teleop/reach3d";
import { DebugTrace, TRACE_SECONDS, traceFileName, traceFrame, type TraceSignals } from "../../teleop/debugTrace";
import { latencyTraceRequested, type TeleopStatus } from "../../teleop/teleopClient";
import { teleopSocketUrl } from "../api";
import { PageTitle } from "../common";
import {
  CALIBRATION,
  CUBE_ROW,
  TABLE_MARK,
  X_RANGE,
  controlFraming,
  framingCheck,
  robotHeight,
  robotReach,
  type Framing,
} from "./framing";
import { LazyHandArtOverlay, type HandArtFrame } from "../handArt";
import { ArtCue } from "./artCue";
import { BreakthroughCue } from "./breakthroughCue";
import { HandControlPanel } from "./HandControlPanel";
import ResetGestureRing from "./ResetGestureRing";
import { RecordLink, type ControlAction, type SimStatus } from "./recordLink";
import "../pm.css";

// MediaPipe hand skeleton: landmark index pairs.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const UI_INTERVAL_MS = 100; // framing text updates at ~10 Hz; the canvas draws every frame
// Hand art (display only) changes style when something happens (ArtCue), crossfading; events
// closer together than the cooldown are dropped, and the crossfade ends before the next can start.
const ART_MORPH_MS = 400;
const ART_COOLDOWN_MS = 400;
const RESET_TOAST_MS = 2500; // how long "Reset fired" stays up after each fire (frame time)

// Same choice as TeleopClient: the right hand, else the first one.
const pickHand = (hands: TrackedHand[]) => hands.find((h) => h.handedness === "Right") ?? hands[0] ?? null;

type Phase = { state: "idle" } | { state: "starting" } | { state: "streaming" } | { state: "error"; message: string };

/** Shown each time the reset gesture fires; `notSent` says why no reset_scene went out. */
type ResetToast = { at: number; notSent: string | null };

type TraceUi = { state: "recording"; progress: number } | { state: "done"; url: string; name: string; frames: number };

function cameraMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked. Allow camera access for this site in the browser, then start again.";
  if (name === "NotFoundError") return "No camera found. Plug one in, then start again.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then start again.";
  return `The camera didn't start: ${err instanceof Error ? err.message : String(err)}`;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Arm height as a fraction of its range, from the same mapping the sim uses (control region or wrist). */
function heightOf(msg: HandPoseMsg): number {
  if (msg.control) return robotHeight(msg.control).fraction;
  const c = CALIBRATION;
  return Math.min(1, Math.max(0, (c.v_max - msg.wrist_uv[1]) / (c.v_max - c.v_min)));
}

/** Arm reach (x) as a fraction of its range: control depth, or the sim's own palm-width mapping. */
function reachOf(msg: HandPoseMsg): { fraction: number; x: number } {
  if (msg.control) return robotReach(msg.control);
  const c = CALIBRATION;
  const fraction = Math.min(1, Math.max(0, (msg.palm_width - c.palm_far) / (c.palm_near - c.palm_far)));
  return { fraction, x: X_RANGE[0] + fraction * (X_RANGE[1] - X_RANGE[0]) };
}

/** Mirrored, like a mirror: the user's right hand appears on the right. artDrawing: the hand-art
 *  overlay draws the hand, so the 2D bones (its no-WebGL fallback) are skipped. */
function draw(
  canvas: HTMLCanvasElement,
  hand: TrackedHand | null,
  framing: Framing,
  settings: TeleopControlSettings,
  gripper: 0 | 1,
  artDrawing: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);
  ctx.clearRect(0, 0, w, h);
  const x = (u: number) => (1 - u) * w;
  const y = (v: number) => v * h;

  // The control region (or, with it off, the sim's own wrist box). Its bottom edge is table height.
  const r = settings.region;
  const box = settings.enabled
    ? { u0: r.centerX - r.width / 2, u1: r.centerX + r.width / 2, v0: r.centerY - r.height / 2, v1: r.centerY + r.height / 2 }
    : { u0: CALIBRATION.u_min, u1: CALIBRATION.u_max, v0: CALIBRATION.v_min, v1: CALIBRATION.v_max };
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.lineWidth = dpr;
  ctx.strokeStyle = framing.state === "edge" ? cssVar("--warm-line") : cssVar("--border-strong");
  ctx.strokeRect(x(box.u1), y(box.v0), x(box.u0) - x(box.u1), y(box.v1) - y(box.v0));
  ctx.setLineDash([]);
  ctx.fillStyle = cssVar("--text-muted");
  ctx.font = `${11 * dpr}px sans-serif`;
  ctx.fillText("table", x(box.u1) + 4 * dpr, y(box.v1) - 4 * dpr);
  if (!hand) return;

  const lm = hand.landmarks;
  if (!artDrawing) {
    ctx.strokeStyle = cssVar("--accent");
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(x(lm[a].x), y(lm[a].y));
      ctx.lineTo(x(lm[b].x), y(lm[b].y));
    }
    ctx.stroke();
    ctx.fillStyle = cssVar("--text");
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(x(p.x), y(p.y), 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The hand dot: the point that drives the arm (palm center, or the wrist with the region off).
  // Filled while the gripper is closed.
  const dot = settings.enabled ? palmCenter(lm) : lm[0];
  ctx.beginPath();
  ctx.arc(x(dot.x), y(dot.y), 7 * dpr, 0, Math.PI * 2);
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = cssVar("--accent");
  ctx.stroke();
  if (gripper) {
    ctx.fillStyle = cssVar("--accent");
    ctx.fill();
  }
}

const TRACK_TEXT: Record<TrackingStatus, string> = {
  idle: "off",
  loading: "starting",
  tracking: "tracking",
  "no-hand": "no hand in view",
  error: "frames stopped",
};

const SINK_COMMAND = "C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\teleop_sink.py --viz kit";
const STEP_S = 0.02; // the sim records at 50 Hz (sim_worker/teleop_session.py TELEOP_DT)

export default function RecordPage() {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [track, setTrack] = useState<TrackingStatus>("idle");
  const [relay, setRelay] = useState<TeleopStatus>({ socketOpen: false, simConnected: false, lastError: null });
  const [sim, setSim] = useState<SimStatus | null>(null);
  const [pose, setPose] = useState<{
    msg: HandPoseMsg;
    framing: Framing;
    gripper: 0 | 1;
    pinch: number | null; // the pinch gap (pinch.ts)
    victory: number | null;
    reset: ResetGestureStatus;
    size3d: number | null; // the 3D reach signal, shown next to the palm width either way
  } | null>(null);
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
    const { createMediapipeTracker } = await import("../../hand/tracking");
    const tracker = createMediapipeTracker();
    session.current = { tracker, link: null };
    let lastUi = -Infinity;
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
        cue: cue.update({ gripper, recording: recordingNow.current, resets: resets.current }),
      };
      if (canvas.current) draw(canvas.current, hand, framing, s, gripper, s.showHandArt && artActive.current);
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
        lastUi = frame.timestamp;
        setPose({ msg, framing, gripper, pinch, victory, reset, size3d });
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

  return (
    <Zones
      hero={
        <>
          <PageTitle title="Record">
            Move your hand in front of the webcam and the simulated arm follows. Pinch to close the gripper.
          </PageTitle>
          <div className="pm-stage">
            <canvas ref={canvas} aria-label="Your hand, mirrored, with the workspace box" />
            {settings.showHandArt && streaming && (
              <LazyHandArtOverlay
                source={() => artHand.current}
                trigger="events"
                morphMs={ART_MORPH_MS}
                cooldownMs={ART_COOLDOWN_MS}
                onActiveChange={(active) => (artActive.current = active)}
              />
            )}
            {!streaming && (
              <div className="pm-stage-idle">
                <p className="muted">
                  {phase.state === "starting" ? "Starting the camera…" : "The camera is off. Nothing is sent until you start."}
                </p>
              </div>
            )}
            {streaming && (
              <div className="pm-stage-caption" aria-live="polite">
                {lost && (
                  <StatusPill tone="warm">Hand tracking lost. The arm holds still until your hand is back.</StatusPill>
                )}
                {pose?.framing.hints.map((hint) => (
                  <StatusPill key={hint} tone="warm">
                    {hint}
                  </StatusPill>
                ))}
                {pose?.framing.state === "ok" && !lost && <StatusPill tone="accent">In the workspace</StatusPill>}
                <ResetGestureRing status={pose?.reset ?? null} />
                {resetToast && <ResetFiredToast toast={resetToast} />}
              </div>
            )}
            {streaming && pose?.msg.tracking_ok && <HandFeedback msg={pose.msg} gripper={pose.gripper} />}
          </div>
          {phase.state === "error" && (
            <GlassCard variant="provisional" className="empty-state">
              <h2>Can't start the camera</h2>
              <p className="muted" role="alert">
                {phase.message}
              </p>
            </GlassCard>
          )}
          {streaming && relay.socketOpen && !relay.simConnected && (
            <GlassCard variant="provisional" className="empty-state">
              <h2>The sim isn't connected</h2>
              <p className="muted">Start the Isaac sink in a terminal, then wait for the arm to appear:</p>
              <code className="pm-command">{SINK_COMMAND}</code>
            </GlassCard>
          )}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <h2>Camera and link</h2>
        {streaming ? (
          <button type="button" className="ghost-button" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={start} disabled={phase.state === "starting"}>
            Start camera
          </button>
        )}
        <dl className="pm-status-list">
          <dt>Camera</dt>
          <dd>{TRACK_TEXT[track]}</dd>
          <dt>Backend relay</dt>
          <dd>{relay.socketOpen ? "connected" : streaming ? "not connected; is the backend running?" : "off"}</dd>
          <dt>Sim</dt>
          <dd>{relay.simConnected ? "connected" : relay.socketOpen ? "not connected" : "off"}</dd>
        </dl>
        {relay.lastError && (
          <p className="small" role="alert">
            The relay rejected a message: {relay.lastError}
          </p>
        )}
        {trace?.state === "recording" ? (
          <div className="stack" role="status">
            <p className="small">Recording a debug trace: move, pinch and reach as you normally would.</p>
            <progress max={1} value={trace.progress} aria-label="Debug trace progress" />
          </div>
        ) : (
          <button type="button" className="ghost-button" onClick={startTrace} disabled={!streaming}>
            Record debug trace ({TRACE_SECONDS} s)
          </button>
        )}
        {trace?.state === "done" && (
          <p className="small" role="status">
            <a href={trace.url} download={trace.name}>
              Download debug trace
            </a>{" "}
            ({trace.frames} frames). It saves to your Downloads folder as {trace.name}; send that file to the lead.
          </p>
        )}
      </GlassCard>

      <GlassCard as="section" className="stack">
        <div className="row spread">
          <h2>Record a demo</h2>
          {recording && (
            <StatusPill tone={sim?.paused ? "warm" : "danger"}>{sim?.paused ? "Paused: hand tracking lost" : "Recording"}</StatusPill>
          )}
        </div>
        {recording ? (
          <button type="button" className="primary-button" onClick={() => control("record_stop")}>
            Stop and save
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={() => control("record_start")} disabled={!simReady}>
            Start recording
          </button>
        )}
        <button type="button" className="ghost-button" onClick={() => control("reset_scene")} disabled={!simReady || recording}>
          Reset scene
        </button>
        <dl className="pm-status-list pm-num">
          <dt>Recorded</dt>
          <dd data-testid="recorded">{sim ? `${(sim.steps * STEP_S).toFixed(1)} s (${sim.steps} steps)` : "–"}</dd>
          {sim?.demoId && (
            <>
              <dt>Saved</dt>
              <dd>
                <Link to={`/pm/review?id=${encodeURIComponent(sim.demoId)}`}>Review {sim.demoId}</Link>
              </dd>
            </>
          )}
        </dl>
        {simReady && sim?.lastResult && (
          <p className="small" role="status">
            {sim.lastResult}
          </p>
        )}
      </GlassCard>

      <HandControlPanel
        settings={settings}
        onChange={updateSettings}
        canCalibrate={streaming}
        calibration={calibration}
        onCalibrate={startCalibration}
        onCancelCalibration={cancelCalibration}
        recentering={recentering}
        onRecenter={startRecenter}
        readout={{
          palmWidth: pose?.msg.tracking_ok ? pose.msg.palm_width : null,
          size3d: pose?.msg.tracking_ok ? pose.size3d : null,
          pinch: pose?.msg.tracking_ok ? pose.pinch : null,
          victory: pose?.victory ?? null,
          control: pose?.msg.tracking_ok ? pose.msg.control ?? null : null,
        }}
      />

      <p className="muted small panel-note">
        The arm follows your hand even when not recording, so you can line up first. Each stop saves a human demo with
        its episode; review it before perfecting.
      </p>
    </Zones>
  );
}

/** "Reset fired", shown every time the reset gesture fires, so an accidental reset is visible. */
function ResetFiredToast({ toast }: { toast: ResetToast }) {
  const text = toast.notSent ? `Reset fired (not sent: ${toast.notSent})` : "Reset fired";
  return (
    <span role="status" aria-label={text}>
      <StatusPill tone={toast.notSent ? "warm" : "accent"}>{text}</StatusPill>
    </span>
  );
}

/** Live feedback over the camera view: the arm's target height (table marked) and reach (cube row
 *  marked), and the gripper. */
function HandFeedback({ msg, gripper }: { msg: HandPoseMsg; gripper: 0 | 1 }) {
  const fraction = heightOf(msg);
  const percent = Math.round(fraction * 100);
  const atTable = fraction <= TABLE_MARK + 0.03;
  const label = atTable ? "at the table" : `${percent}% up`;
  const reach = reachOf(msg);
  const reachPercent = Math.round(reach.fraction * 100);
  const reachCm = `x = ${Math.round(reach.x * 100)} cm`;
  const reachLabel = Math.abs(reach.fraction - CUBE_ROW) <= 0.05 ? `${reachCm}, at the cube's row` : reachCm;
  return (
    <div className="pm-hand-feedback">
      <div className="pm-meters">
        <div className="pm-meter">
          <div
            className="pm-height-bar"
            role="meter"
            aria-label="Robot height"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={label}
          >
            <div className="pm-height-fill" style={{ height: `${percent}%` }} />
            <div className="pm-height-table" style={{ bottom: `${TABLE_MARK * 100}%` }} title="table" />
          </div>
          <span className="small">height</span>
        </div>
        <div className="pm-meter">
          <span className="small">fwd</span>
          <div
            className="pm-height-bar"
            role="meter"
            aria-label="Reach"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={reachPercent}
            aria-valuetext={reachLabel}
          >
            <div className="pm-height-fill" style={{ height: `${reachPercent}%` }} />
            <div className="pm-height-table" style={{ bottom: `${CUBE_ROW * 100}%` }} title="the cube's row" />
          </div>
          <span className="small">back</span>
        </div>
      </div>
      <span className="small">{label}</span>
      <span className="small pm-num">reach {reachLabel}</span>
      <StatusPill tone={gripper ? "accent" : "neutral"}>{gripper ? "Gripper closed" : "Gripper open"}</StatusPill>
    </div>
  );
}
