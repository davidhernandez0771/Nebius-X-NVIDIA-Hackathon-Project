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
import type { TeleopStatus } from "../../teleop/teleopClient";
import { teleopSocketUrl } from "../api";
import { PageTitle } from "../common";
import {
  CALIBRATION,
  CUBE_ROW,
  TABLE_MARK,
  X_RANGE,
  controlFraming,
  framingCheck,
  nextGripper,
  robotHeight,
  robotReach,
  type Framing,
} from "./framing";
import { HandControlPanel } from "./HandControlPanel";
import { RecordLink, type ControlAction, type SimStatus } from "./recordLink";
import "../pm.css";

// MediaPipe hand skeleton: landmark index pairs.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const UI_INTERVAL_MS = 100; // framing text updates at ~10 Hz; the canvas draws every frame

// Same choice as TeleopClient: the right hand, else the first one.
const pickHand = (hands: TrackedHand[]) => hands.find((h) => h.handedness === "Right") ?? hands[0] ?? null;

type Phase = { state: "idle" } | { state: "starting" } | { state: "streaming" } | { state: "error"; message: string };

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

/** Mirrored, like a mirror: the user's right hand appears on the right. */
function draw(canvas: HTMLCanvasElement, hand: TrackedHand | null, framing: Framing, settings: TeleopControlSettings, gripper: 0 | 1) {
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
  const [pose, setPose] = useState<{ msg: HandPoseMsg; framing: Framing; gripper: 0 | 1 } | null>(null);
  const [settings, setSettings] = useState<TeleopControlSettings>(loadTeleopControl);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [recentering, setRecentering] = useState(false);
  const settingsRef = useRef(settings);
  const calibrator = useRef<TeleopCalibrator | null>(null);
  const centerer = useRef<ReachCenterer | null>(null);
  const calibrationStep = useRef<CalibrationState["step"] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<{ tracker: TrackingAdapter; link: RecordLink | null } | null>(null);

  function updateSettings(next: TeleopControlSettings) {
    settingsRef.current = next;
    setSettings(next);
    saveTeleopControl(next);
    session.current?.link?.setControl(next.enabled ? next : null);
  }

  function teardown() {
    calibrator.current = null;
    centerer.current = null;
    session.current?.tracker.cleanup();
    session.current?.link?.close();
    session.current = null;
  }
  useEffect(() => teardown, []);

  async function start() {
    setPhase({ state: "starting" });
    const { createMediapipeTracker } = await import("../../hand/tracking");
    const tracker = createMediapipeTracker();
    session.current = { tracker, link: null };
    let lastUi = -Infinity;
    let last: HandPoseMsg | undefined;
    let gripper: 0 | 1 = 0;
    // Auto-centered reach: unless the depth range was calibrated or set by hand, center it on the
    // hand's natural distance once tracking starts (ReachCenterer: ~1 s of palm widths).
    centerer.current = settingsRef.current.depthAuto ? new ReachCenterer() : null;
    setRecentering(centerer.current !== null);
    tracker.onStatus(setTrack);
    tracker.onFrame((frame: HandFrame) => {
      session.current?.link?.push(frame);
      const s = settingsRef.current;
      const hand = pickHand(frame.hands);
      // The same message the link sends, so what the page shows is what the sim gets.
      const msg = toHandPoseMsg(hand, frame, last, s);
      last = msg;
      if (centerer.current) recenter(centerer.current, frame.timestamp, msg);
      const tracked = msg.tracking_ok && hand ? { center: palmCenter(hand.landmarks), palmWidth: msg.palm_width } : null;
      const framing = s.enabled ? controlFraming(tracked, s) : framingCheck(msg);
      gripper = nextGripper(gripper, msg);
      if (canvas.current) draw(canvas.current, hand, framing, s, gripper);
      const uiTick = frame.timestamp - lastUi >= UI_INTERVAL_MS;
      if (calibrator.current) calibrate(calibrator.current, frame.timestamp, tracked, uiTick);
      if (uiTick) {
        lastUi = frame.timestamp;
        setPose({ msg, framing, gripper });
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
    const link = new RecordLink(teleopSocketUrl());
    link.setControl(settingsRef.current.enabled ? settingsRef.current : null);
    link.onStatus(setRelay);
    link.onSimStatus(setSim);
    if (session.current) session.current.link = link;
    setPhase({ state: "streaming" });
  }

  type Tracked = { center: { x: number; y: number }; palmWidth: number } | null;

  /** One frame of reach centering; the result applies (and saves) at once. */
  function recenter(c: ReachCenterer, t: number, msg: HandPoseMsg) {
    const reach = c.push(t, msg.tracking_ok ? msg.palm_width : null);
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

  function stop() {
    teardown();
    setCalibration(null);
    setRecentering(false);
    setTrack("idle");
    setRelay({ socketOpen: false, simConnected: false, lastError: null });
    setSim(null);
    setPose(null);
    setPhase({ state: "idle" });
  }

  const control = (action: ControlAction) => session.current?.link?.sendControl(action);

  const streaming = phase.state === "streaming";
  const lost = streaming && (track === "no-hand" || track === "error");
  const simReady = streaming && relay.simConnected;
  const recording = simReady && !!sim?.recording;

  return (
    <Zones
      hero={
        <>
          <PageTitle title="Record">
            Move your hand in front of the webcam and the simulated arm follows. Pinch to close the gripper.
          </PageTitle>
          <div className="pm-stage">
            <canvas ref={canvas} aria-label="Your hand, mirrored, with the workspace box" />
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
          pinch: pose?.msg.tracking_ok ? pose.msg.pinch_ratio : null,
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
