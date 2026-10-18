// /record: the Record page in the Volt look. T7's instrument-rack tiles (site/record-hud, after
// docs/design/prototypes/record-console.html) around the camera view, fed by the same teleop
// session as /pm/record (useRecordSession: hand v4's simple pinch, reset gesture, original hand
// art, control region, break-through). The page always fits the window: a 100dvh grid, no page
// scrollbar, nothing scrolls inside a tile; the rare settings sit in a slide-over drawer.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import type { TrackingStatus } from "../../hand/contracts";
import { LazyHandArtOverlay } from "../../pm/handArt";
import ResetGestureRing from "../../pm/record/ResetGestureRing";
import type { StagePalette } from "../../pm/record/stageDraw";
import { ART_COOLDOWN_MS, ART_MORPH_MS, SINK_COMMAND, STEP_S, useRecordSession, type PoseUi, type RecordSession } from "../../pm/record/useRecordSession";
import { PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE } from "../../teleop/pinch";
import {
  CamTile,
  ChannelTile,
  GRASP_Z,
  GripKnobTile,
  HeightTraceTile,
  PalmPadTile,
  RecordControl,
  StatusChip,
  WORKSPACE,
  initialHud,
  type Chip,
  type HudState,
  type RecordState,
} from "../record-hud";
import { LIVE_HISTORY, stepLiveHud } from "./liveHud";
import { RecordSettings } from "./RecordSettings";
import "../record-hud/record-hud.css";
import "./record-console.css";

const DRAWER_ID = "rc-settings";
const LINKS = [
  { to: "/record", label: "Record" },
  { to: "/pm/review", label: "Review" },
  { to: "/pm/dataset", label: "Dataset" },
];
const EPISODE: Record<RecordState, string> = { idle: "idle", recording: "rec", paused: "paused" };
const TRACK_DETAIL: Partial<Record<TrackingStatus, string>> = { loading: "starting", "no-hand": "no hand", error: "frames stopped" };

/** The stage canvas in Volt colours, read from the rack's own tokens (one signal orange for the hand dot). */
function stagePalette(el: HTMLElement): StagePalette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    line: v("--sant-control", "#5E6A77"),
    edge: v("--sant-issue", "#FFB000"),
    label: v("--sant-muted", "#8B95A1"),
    bones: v("--sant-text", "#E6EDF3"),
    joints: v("--sant-text", "#E6EDF3"),
    dot: "#ff5a1f", // record-hud.css --rh-needle
    font: v("--sant-font-data", "monospace"),
  };
}

function chipsFor(s: RecordSession): Chip[] {
  const { phase, track, relay, streaming } = s;
  const hand: Chip =
    phase.state === "starting"
      ? { label: "hand_track", state: "wait", detail: "starting" }
      : phase.state === "error"
        ? { label: "hand_track", state: "wait", detail: "no camera" }
        : !streaming
          ? { label: "hand_track", state: "off" }
          : track === "tracking"
            ? { label: "hand_track", state: "ok" }
            : { label: "hand_track", state: "wait", detail: TRACK_DETAIL[track] ?? track };
  const link: Chip = !streaming ? { label: "relay", state: "off" } : relay.socketOpen ? { label: "relay", state: "ok" } : { label: "relay", state: "wait", detail: "not connected" };
  const sim: Chip = relay.simConnected ? { label: "sim_link", state: "ok" } : relay.socketOpen ? { label: "sim_link", state: "wait", detail: "not connected" } : { label: "sim_link", state: "off" };
  return [hand, link, sim];
}

/** The rack state for the latest pose, stepped once per pose (idempotent across re-renders). */
function useLiveHud(pose: PoseUi | null): HudState {
  const last = useRef<{ pose: PoseUi | null; hud: HudState }>({ pose: null, hud: initialHud() });
  if (last.current.pose !== pose) last.current = { pose, hud: stepLiveHud(last.current.hud, pose) };
  return last.current.hud;
}

export function RecordConsole() {
  const [palette, setPalette] = useState<StagePalette | undefined>(undefined);
  const session = useRecordSession({ palette });
  const { phase, relay, sim, pose, settings, streaming, lost, simReady, recording, resetToast } = session;
  const hud = useLiveHud(pose);
  const [drawer, setDrawer] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const rack = useCallback((el: HTMLDivElement | null) => {
    if (el) setPalette(stagePalette(el));
  }, []);

  const closeDrawer = () => {
    setDrawer(false);
    settingsButton.current?.focus();
  };

  const rec: RecordState = recording ? (sim?.paused ? "paused" : "recording") : "idle";
  const t = hud.target;
  const noSim = streaming && relay.socketOpen && !relay.simConnected;

  const message =
    phase.state === "error" ? (
      <div className="rc-message">
        <p className="rc-message__title">Can't start the camera</p>
        <p role="alert">{phase.message}</p>
        <button type="button" className="rc-btn rc-btn--primary" onClick={session.start}>
          Start camera
        </button>
      </div>
    ) : phase.state === "starting" ? (
      <p className="rc-message">Starting the camera…</p>
    ) : !streaming ? (
      <div className="rc-message">
        <p>The camera is off. Nothing is sent until you start.</p>
        <button type="button" className="rc-btn rc-btn--primary" onClick={session.start}>
          Start camera
        </button>
      </div>
    ) : undefined;

  const footStatus = streaming ? (lost ? "hand lost: the arm holds still" : simReady && sim?.lastResult ? sim.lastResult : null) : null;

  return (
    <AppShell
      title="Record"
      active={0}
      links={LINKS}
      actions={
        <div className="rh rc-actions" data-mode="volt">
          <div className="rh-bar__chips" role="group" aria-label="Status">
            {chipsFor(session).map((c) => (
              <StatusChip key={c.label} {...c} />
            ))}
          </div>
          {streaming ? (
            <button type="button" className="rc-btn" onClick={session.stop}>
              Stop camera
            </button>
          ) : (
            <button type="button" className="rc-btn" onClick={session.start} disabled={phase.state === "starting"}>
              Start camera
            </button>
          )}
          <button type="button" className="rc-btn" onClick={() => session.control("reset_scene")} disabled={!simReady || recording}>
            Reset scene
          </button>
          <RecordControl
            state={rec}
            elapsedMs={sim ? sim.steps * STEP_S * 1000 : 0}
            onToggle={() => session.control(recording ? "record_stop" : "record_start")}
            disabled={!simReady}
          />
          <button
            ref={settingsButton}
            type="button"
            className="rc-btn"
            aria-expanded={drawer}
            aria-controls={DRAWER_ID}
            onClick={() => (drawer ? closeDrawer() : setDrawer(true))}
          >
            Settings
          </button>
        </div>
      }
    >
      <div className="rh rc" data-mode="volt" ref={rack}>
        <CamTile size="mirror" hint="pinch = grip · ✌ hold 1.5 s = reset_scene" status={footStatus} message={message}>
          <div className="rc-stage">
            <canvas ref={session.canvas} aria-label="Your hand, mirrored, with the workspace box" />
            {settings.showHandArt && streaming && (
              <LazyHandArtOverlay
                source={() => session.artHand.current}
                trigger="events"
                morphMs={ART_MORPH_MS}
                cooldownMs={ART_COOLDOWN_MS}
                onActiveChange={(active) => (session.artActive.current = active)}
              />
            )}
          </div>
          {streaming && (
            <>
              <div className="rc-ring">
                <ResetGestureRing status={pose?.reset ?? null} showHint={false} size={32} />
              </div>
              <div className="rc-captions" aria-live="polite">
                {lost && <Caption tone="wait">Hand tracking lost. The arm holds still until your hand is back.</Caption>}
                {pose?.framing.hints.map((hint) => (
                  <Caption key={hint} tone="wait">
                    {hint}
                  </Caption>
                ))}
                {pose?.framing.state === "ok" && !lost && <Caption tone="ok">In the workspace</Caption>}
                {resetToast && <ResetFired notSent={resetToast.notSent} />}
              </div>
            </>
          )}
          {(noSim || relay.lastError) && (
            <div className="rc-notice" role={relay.lastError ? "alert" : undefined}>
              {noSim && (
                <>
                  <p>The sim isn't connected. Start the Isaac sink in a terminal, then wait for the arm to appear:</p>
                  <code>{SINK_COMMAND}</code>
                </>
              )}
              {relay.lastError && <p>The relay rejected a message: {relay.lastError}</p>}
            </div>
          )}
        </CamTile>

        <div className="rc-side">
          <PalmPadTile x={t?.pad.x ?? null} y={t?.pad.y ?? null} edge={t?.edge} />
          <GripKnobTile
            pinch={hud.pinch}
            gripper={t ? hud.gripper : null}
            stale={!hud.tracking && t !== null}
            thresholds={[PINCH_OPEN_ABOVE, PINCH_CLOSE_BELOW]}
            unit="pinch gap"
          />
          <HeightTraceTile
            z={t?.ee[2] ?? null}
            zHistory={hud.zHistory}
            zRange={WORKSPACE.z}
            xHistory={hud.xHistory}
            xRange={WORKSPACE.x}
            graspZ={GRASP_Z}
            capacity={LIVE_HISTORY}
          />
          <div className="rc-channels">
            <ChannelTile label="ee_target_x" unit="m" value={t?.ee[0]} decimals={3} />
            <ChannelTile label="ee_target_y" unit="m" value={t?.ee[1]} decimals={3} />
            <ChannelTile label="pinch_gap" unit="—" value={hud.tracking ? hud.pinch : null} />
            <ChannelTile label="v_sign" unit="score" value={streaming ? pose?.victory : null} />
            <ChannelTile label="recorded" unit="s" value={sim ? sim.steps * STEP_S : null} decimals={1} />
            <ChannelTile label="episode" unit="state">
              <p className="rh-state" data-state={rec}>
                <span className="rh-state__dot" aria-hidden="true" />
                {EPISODE[rec]}
              </p>
              {sim?.demoId && (
                <Link className="rc-review" to={`/pm/review?id=${encodeURIComponent(sim.demoId)}`}>
                  Review {sim.demoId}
                </Link>
              )}
            </ChannelTile>
          </div>
        </div>

        <RecordSettings id={DRAWER_ID} open={drawer} onClose={closeDrawer} session={session} />
      </div>
    </AppShell>
  );
}

export default RecordConsole;

/** A caption over the camera view: the chip look, with the text as the whole message. */
function Caption({ tone, children }: { tone: "ok" | "wait"; children: ReactNode }) {
  return (
    <span className="rh-chip rc-caption" data-state={tone}>
      <span className="rh-chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** "Reset fired", shown every time the reset gesture fires, so an accidental reset is visible. */
function ResetFired({ notSent }: { notSent: string | null }) {
  const text = notSent ? `Reset fired (not sent: ${notSent})` : "Reset fired";
  return (
    <span role="status" aria-label={text}>
      <Caption tone={notSent ? "wait" : "ok"}>{text}</Caption>
    </span>
  );
}
