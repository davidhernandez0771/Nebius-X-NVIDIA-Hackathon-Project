import { useEffect, useRef, useState } from "react";
import { GlassCard, StatusPill, Zones } from "../../components";
import type { HandFrame, TrackedHand, TrackingAdapter, TrackingStatus } from "../../hand/contracts";
import { toHandPoseMsg, type HandPoseMsg } from "../../teleop/handPoseMessage";
import { TeleopClient, type TeleopStatus } from "../../teleop/teleopClient";
import { teleopSocketUrl } from "../api";
import { PageTitle } from "../common";
import { CALIBRATION, framingCheck, type Framing } from "./framing";
import "../pm.css";

// MediaPipe hand skeleton: landmark index pairs.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const UI_INTERVAL_MS = 100; // framing text updates at ~10 Hz; the canvas draws every frame

// Same choice as TeleopClient: the right hand, else the first one.
const pickHand = (hands: TrackedHand[]) => hands.find((h) => h.handedness === "Right") ?? hands[0] ?? null;

type Phase = { state: "idle" } | { state: "starting" } | { state: "streaming"; since: number } | { state: "error"; message: string };

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

/** Mirrored, like a mirror: the user's right hand appears on the right. */
function draw(canvas: HTMLCanvasElement, hand: TrackedHand | null, framing: Framing) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);
  ctx.clearRect(0, 0, w, h);
  const x = (u: number) => (1 - u) * w;
  const y = (v: number) => v * h;

  const c = CALIBRATION;
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.lineWidth = dpr;
  ctx.strokeStyle = framing.state === "edge" ? cssVar("--warm-line") : cssVar("--border-strong");
  ctx.strokeRect(x(c.u_max), y(c.v_min), x(c.u_min) - x(c.u_max), y(c.v_max) - y(c.v_min));
  ctx.setLineDash([]);
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
}

const TRACK_TEXT: Record<TrackingStatus, string> = {
  idle: "off",
  loading: "starting",
  tracking: "tracking",
  "no-hand": "no hand in view",
  error: "frames stopped",
};

export default function RecordPage() {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [track, setTrack] = useState<TrackingStatus>("idle");
  const [relay, setRelay] = useState<TeleopStatus>({ socketOpen: false, simConnected: false, lastError: null });
  const [pose, setPose] = useState<{ msg: HandPoseMsg; framing: Framing } | null>(null);
  const [now, setNow] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<{ tracker: TrackingAdapter; client: TeleopClient | null } | null>(null);

  function teardown() {
    session.current?.tracker.cleanup();
    session.current?.client?.close();
    session.current = null;
  }
  useEffect(() => teardown, []);

  useEffect(() => {
    if (phase.state !== "streaming") return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [phase.state]);

  async function start() {
    setPhase({ state: "starting" });
    const { createMediapipeTracker } = await import("../../hand/tracking");
    const tracker = createMediapipeTracker();
    session.current = { tracker, client: null };
    let lastUi = -Infinity;
    let last: HandPoseMsg | undefined;
    tracker.onStatus(setTrack);
    tracker.onFrame((frame: HandFrame) => {
      session.current?.client?.push(frame);
      const msg = toHandPoseMsg(pickHand(frame.hands), frame, last);
      last = msg;
      const framing = framingCheck(msg);
      if (canvas.current) draw(canvas.current, pickHand(frame.hands), framing);
      if (frame.timestamp - lastUi >= UI_INTERVAL_MS) {
        lastUi = frame.timestamp;
        setPose({ msg, framing });
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
    const client = new TeleopClient(teleopSocketUrl());
    client.onStatus(setRelay);
    if (session.current) session.current.client = client;
    const since = performance.now();
    setNow(since);
    setPhase({ state: "streaming", since });
  }

  function stop() {
    teardown();
    setTrack("idle");
    setRelay({ socketOpen: false, simConnected: false, lastError: null });
    setPose(null);
    setPhase({ state: "idle" });
  }

  const streaming = phase.state === "streaming";
  const lost = streaming && (track === "no-hand" || track === "error");
  const seconds = streaming ? Math.max(0, (now - phase.since) / 1000) : 0;

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
          </div>
          {phase.state === "error" && (
            <GlassCard variant="provisional" className="empty-state">
              <h2>Can't start recording</h2>
              <p className="muted" role="alert">
                {phase.message}
              </p>
            </GlassCard>
          )}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <div className="row spread">
          <h2>Session</h2>
          <span className="pm-clock" aria-label={`${seconds.toFixed(0)} seconds`}>
            {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, "0")}
          </span>
        </div>
        {streaming ? (
          <button type="button" className="primary-button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={start} disabled={phase.state === "starting"}>
            Start streaming
          </button>
        )}
        <dl className="pm-status-list">
          <dt>Camera</dt>
          <dd>{TRACK_TEXT[track]}</dd>
          <dt>Backend relay</dt>
          <dd>{relay.socketOpen ? "connected" : streaming ? "not connected; is the backend running?" : "off"}</dd>
          <dt>Sim worker</dt>
          <dd>{relay.simConnected ? "following your hand" : relay.socketOpen ? "not connected to the relay" : "off"}</dd>
        </dl>
        {relay.lastError && (
          <p className="small" role="alert">
            The relay rejected a message: {relay.lastError}
          </p>
        )}
      </GlassCard>

      <GlassCard as="section" className="stack">
        <h2>Calibration</h2>
        <p className="muted small">
          Keep your wrist inside the dashed box, palm toward the camera. Outside it, the arm stops at the edge of its
          workspace.
        </p>
        <dl className="pm-status-list pm-num">
          <dt>Palm width</dt>
          <dd>
            {pose?.msg.tracking_ok ? pose.msg.palm_width.toFixed(3) : "–"}{" "}
            <span className="muted">
              (aim for {CALIBRATION.palm_far} to {CALIBRATION.palm_near})
            </span>
          </dd>
          <dt>Pinch</dt>
          <dd>{pose?.msg.tracking_ok ? pose.msg.pinch_ratio.toFixed(2) : "–"}</dd>
        </dl>
      </GlassCard>

      <p className="muted small panel-note">
        This page streams your hand to the sim worker through the backend. Saving a recording as a demo happens on the
        sim side, which isn't connected yet.
      </p>
    </Zones>
  );
}
