import { Link } from "react-router-dom";
import { GlassCard, StatusPill, Zones } from "../../components";
import type { TrackingStatus } from "../../hand/contracts";
import type { HandPoseMsg } from "../../teleop/handPoseMessage";
import { TRACE_SECONDS } from "../../teleop/debugTrace";
import { PageTitle } from "../common";
import { CALIBRATION, CUBE_ROW, TABLE_MARK, X_RANGE, robotHeight, robotReach } from "./framing";
import { LazyHandArtOverlay } from "../handArt";
import { HandControlPanel } from "./HandControlPanel";
import ResetGestureRing from "./ResetGestureRing";
import { ART_COOLDOWN_MS, ART_MORPH_MS, SINK_COMMAND, STEP_S, useRecordSession, type ResetToast } from "./useRecordSession";
import "../pm.css";

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

const TRACK_TEXT: Record<TrackingStatus, string> = {
  idle: "off",
  loading: "starting",
  tracking: "tracking",
  "no-hand": "no hand in view",
  error: "frames stopped",
};

// The teleop session lives in useRecordSession (shared with /record); this page only lays it out.
export default function RecordPage() {
  const {
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
    canvas,
    artHand,
    artActive,
    start,
    stop,
    control,
    updateSettings,
    startRecenter,
    startCalibration,
    cancelCalibration,
    startTrace,
  } = useRecordSession();

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
