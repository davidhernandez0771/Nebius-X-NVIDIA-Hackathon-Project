// /record, "inside the hologram" (docs/design/prototypes/record-hologram.html): you zoomed into the
// machine's projection, so the page is that projection. The cutting-mat grid, the plugged-in robot
// cartridge and the S/A/N/T rail on top, the camera pane with the hand art and the control region,
// the 3D robot twin (live from the sim, else a replay of a verified copy: robotTwin.ts) in three views with
// the alignment grid, the gripper dial and the height and left/right gauges, the bottom strip, and the
// settings drawer. Beside Record: "Stop & discard" while recording (record_discard: nothing is saved), and after
// a save "Delete last demo" (one more click to confirm; DELETE /demos/{id} moves it to demos/_discarded).
// The input switch (Keyboard | Mouse | Camera, in the camera pane's header): with the keyboard or the mouse the camera
// pane shows the key legend and the speed (DrivePanel), there's no camera and no hand lock, and Enter starts or stops
// a recording; in mouse mode a click anywhere on the twin pane takes the mouse (Pointer Lock, Esc releases; the first
// click also starts the mouse session; a refused lock says why and the next click asks again; the twin doesn't orbit).
// Live, the twin's link that pushes on the bin or table glows (amber, red over 5 N) over a quiet force bar with the
// take's peak (ContactBar); the "soft floor" box in the twin's header (on by default) tells the sim to keep the target
// above the bin rim and the table, for every input.
// Everything is fed by the same teleop session as /legacy/pm/record (useRecordSession: hand v4's
// simple pinch, reset gesture, original hand art, control region, break-through). The page fits the
// window: a 100dvh grid, no page scrollbar, nothing scrolls inside a pane.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TrackingStatus } from "../../hand/contracts";
import { describeError, pmApi } from "../../pm/api";
import { LazyHandArtOverlay } from "../../record/handArt";
import ResetGestureRing from "../../record/ResetGestureRing";
import type { StagePalette } from "../../record/stageDraw";
import { ART_COOLDOWN_MS, ART_MORPH_MS, SINK_COMMAND, STEP_S, useRecordSession, type PoseUi, type RecordSession } from "../../record/useRecordSession";
import { useMotion } from "../../sant/motion/MotionProvider";
import { RobotTwin } from "../../twin";
import { formatClock } from "../record-hud";
import { GripDial, HeightGauge, SideGauge, Trace } from "./instruments";
import { GAIN_MAX, GAIN_MIN } from "../../record/teleop/controlRegion";
import { ContactBar } from "./ContactBar";
import { DrivePanel, InputSwitch } from "./DrivePanel";
import { RecordSettings } from "./RecordSettings";
import { useRecordTwin } from "./robotTwin";
import { LIVE_ROBOT, initialLive, stepLive, type LiveState } from "./twin";
import "./record-hologram.css";

const DRAWER_ID = "rg-settings";
const BOOT_MS = 1600; // the plug-in: panes draw in and one scanline sweeps, then it's gone
const CONFIRM_MS = 4000; // "Delete last demo" waits this long for the confirming click, then backs off
const STEPS = ["S · show", "A · check", "N · neaten", "T · train"];
const TRACK_DETAIL: Partial<Record<TrackingStatus, string>> = { loading: "starting", "no-hand": "no hand", error: "frames stopped" };

type Tone = "ok" | "wait" | "off" | "rec";
type ChipView = { label: string; state: Tone; detail?: string };

/** The stage canvas in the hologram's colours, read from the page's own tokens. */
function stagePalette(el: HTMLElement): StagePalette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    line: v("--rg-region", "rgba(25,245,194,.45)"),
    edge: v("--rg-hold", "#ffb000"),
    label: v("--rg-ink-3", "#53625f"),
    bones: v("--rg-bones", "rgba(25,245,194,.55)"),
    joints: v("--rg-live", "#19f5c2"),
    dot: v("--rg-needle", "#ff5a1f"),
    font: v("--rg-mono", "monospace"),
  };
}

function chipsFor(s: RecordSession): ChipView[] {
  const { phase, track, relay, streaming } = s;
  const drive = s.drive.input !== "camera";
  const hand: ChipView = drive
    ? { label: s.drive.input, state: streaming ? "ok" : "off", detail: streaming ? undefined : "stopped" }
    : phase.state === "starting"
      ? { label: "hand", state: "wait", detail: "starting" }
      : phase.state === "error"
        ? { label: "hand", state: "wait", detail: "no camera" }
        : !streaming
          ? { label: "hand", state: "off", detail: "camera off" }
          : track === "tracking"
            ? { label: "hand", state: "ok" }
            : { label: "hand", state: "wait", detail: TRACK_DETAIL[track] ?? track };
  const link: ChipView = !streaming
    ? { label: "relay", state: "off", detail: drive ? "stopped" : "camera off" }
    : relay.socketOpen
      ? { label: "relay", state: "ok" }
      : { label: "relay", state: "wait", detail: "not connected" };
  const sim: ChipView = relay.simConnected
    ? { label: "sim", state: "ok" }
    : relay.socketOpen
      ? { label: "sim", state: "wait", detail: "not connected" }
      : { label: "sim", state: "off", detail: "no relay" };
  return [hand, link, sim];
}

/** The episode cell: what the session is doing right now. */
function episodeOf(s: RecordSession): { text: string; tone: Tone } {
  if (s.phase.state === "starting") return { text: "starting", tone: "wait" };
  if (s.phase.state === "error") return { text: "camera error", tone: "wait" };
  if (!s.streaming) return { text: s.drive.input === "camera" ? "camera off" : "stopped", tone: "off" };
  if (s.recording) return s.sim?.paused ? { text: "paused", tone: "wait" } : { text: "recording", tone: "rec" };
  if (s.drive.input !== "camera") return s.simReady ? { text: "ready", tone: "ok" } : { text: "no sim", tone: "wait" };
  if (s.lost) return { text: "no hand", tone: "wait" };
  return s.track === "tracking" ? { text: "tracking", tone: "ok" } : { text: "waiting", tone: "wait" };
}

/** The live state for the latest pose, stepped once per pose (idempotent across re-renders). */
function useLive(pose: PoseUi | null): LiveState {
  const last = useRef<{ pose: PoseUi | null; live: LiveState }>({ pose: null, live: initialLive() });
  if (last.current.pose !== pose) last.current = { pose, live: stepLive(last.current.live, pose) };
  return last.current.live;
}

/** Saved demos seen this visit (each sim_status names the last one saved). */
function useSavedDemos(demoId: string | null | undefined): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (demoId) setIds((list) => (list.includes(demoId) ? list : [...list, demoId]));
  }, [demoId]);
  return ids;
}

export function RecordConsole() {
  const [palette, setPalette] = useState<StagePalette | undefined>(undefined);
  const session = useRecordSession({ palette, inputs: true });
  return <RecordView session={session} onPalette={setPalette} />;
}

export default RecordConsole;

/** The page for a session: the live one above, or a stand-in when checking the layout. */
export function RecordView({ session, onPalette }: { session: RecordSession; onPalette: (p: StagePalette) => void }) {
  const { phase, relay, sim, pose, settings, streaming, lost, simReady, recording, resetToast } = session;
  const input = session.drive.input;
  const driving = input !== "camera";
  const facing = !driving && settings.view === "facing"; // the mirror mapping: the twin and the gauge turn round
  const twinPane = useRef<HTMLElement>(null);
  const mouse = input === "mouse";
  const mouseLocked = mouse && streaming && !!session.driveUi?.locked;
  const requestMouse = useRef(session.requestMouse);
  requestMouse.current = session.requestMouse;
  // Mouse mode: a left click anywhere on the twin pane takes the mouse (and starts the mouse session first). Captured
  // on the pane, so the twin's canvas never gets it; while locked, clicks are the gripper (driveSession.ts).
  useEffect(() => {
    const pane = twinPane.current;
    if (!mouse || !pane) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element | null)?.closest?.(".rg-hd")) return; // the header's controls stay controls
      e.stopPropagation();
      if (document.pointerLockElement !== pane) requestMouse.current(pane);
    };
    pane.addEventListener("pointerdown", onDown, { capture: true });
    return () => pane.removeEventListener("pointerdown", onDown, { capture: true });
  }, [mouse]);
  const live = useLive(pose);
  const twin = useRecordTwin();
  const savedIds = useSavedDemos(sim?.demoId);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [note, setNote] = useState<{ text: string; title: string } | null>(null); // the last delete's outcome, until the sim reports again
  useEffect(() => setNote(null), [sim?.lastResult, sim?.demoId]);
  const saved = savedIds.filter((id) => !deleted.includes(id)).length;
  const lastDemo = sim?.demoId && !deleted.includes(sim.demoId) ? sim.demoId : null;
  const { reduced } = useMotion();
  const [boot, setBoot] = useState(!reduced);
  const [drawer, setDrawer] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const root = useCallback((el: HTMLDivElement | null) => {
    if (el) onPalette(stagePalette(el));
  }, [onPalette]);

  useEffect(() => {
    if (!boot) return;
    const id = window.setTimeout(() => setBoot(false), BOOT_MS);
    return () => window.clearTimeout(id);
  }, [boot]);
  useEffect(() => {
    if (reduced) setBoot(false);
  }, [reduced]);

  const closeDrawer = () => {
    setDrawer(false);
    settingsButton.current?.focus();
  };

  const rec = recording ? (sim?.paused ? "paused" : "recording") : "idle";
  const { hud } = live;
  const t = hud.target;
  const stale = t !== null && !hud.tracking;
  const noSim = streaming && relay.socketOpen && !relay.simConnected;
  const episode = episodeOf(session);
  const fps = streaming && pose?.fps ? `${Math.round(pose.fps)} fps` : null;
  const footStatus = streaming ? (lost ? "hand lost: the arm holds still" : simReady && sim?.lastResult ? sim.lastResult : null) : null;

  const message = driving ? (
    !streaming && (
      <div className="rg-message">
        <button type="button" className="rg-btn rg-btn--primary" onClick={session.start}>
          Start {input}
        </button>
      </div>
    )
  ) :
    phase.state === "error" ? (
      <div className="rg-message">
        <p className="rg-message__title">Can't start the camera</p>
        <p role="alert">{phase.message}</p>
        <button type="button" className="rg-btn rg-btn--primary" onClick={session.start}>
          Start camera
        </button>
      </div>
    ) : phase.state === "starting" ? (
      <p className="rg-message">Starting the camera…</p>
    ) : !streaming ? (
      <div className="rg-message">
        <p>The camera is off. Nothing is sent until you start.</p>
        <button type="button" className="rg-btn rg-btn--primary" onClick={session.start}>
          Start camera
        </button>
      </div>
    ) : null;

  return (
    <div className="rg" data-boot={boot || undefined} ref={root}>
      <div className="rg-mat" aria-hidden="true" />
      {boot && <div className="rg-scan" aria-hidden="true" />}

      <header className="rg-top">
        <div className="rg-crumb">
          <Link className="rg-btn rg-eject" to="/" title="Eject the cartridge and go back to the workshop">
            <span aria-hidden="true">⏏</span> workshop
          </Link>
          <span className="rg-cart" title="The robot plugged in: the arm the live sim drives">
            <i aria-hidden="true" />
            <b>{LIVE_ROBOT.code}</b>
            <span>{LIVE_ROBOT.name}</span>
          </span>
          <h1 className="rg-title">Record</h1>
        </div>
        <nav className="rg-steps" aria-label="SANT steps">
          {STEPS.map((step, i) => (
            <span key={step} className="rg-steps__item">
              {i > 0 && <em aria-hidden="true" />}
              <span className="rg-step" aria-current={i === 0 ? "step" : undefined}>
                {step}
              </span>
            </span>
          ))}
        </nav>
        <div className="rg-right">
          <div className="rg-chips" role="group" aria-label="Status">
            {chipsFor(session).map((c) => (
              <span key={c.label} className="rg-chip" data-state={c.state} title={c.detail}>
                <span className="rg-dot" aria-hidden="true" />
                {c.label}
                {c.detail && <span className="rg-sr">: {c.detail}</span>}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="rg-rec"
            aria-pressed={recording}
            data-state={rec}
            disabled={!simReady}
            title={simReady ? undefined : "Connect the sim to record"}
            onClick={() => session.control(recording ? "record_stop" : "record_start")}
          >
            <i aria-hidden="true" />
            <span>Record</span>
          </button>
          {recording && (
            <button type="button" className="rg-btn rg-btn--small" onClick={() => session.control("record_discard")}>
              Stop &amp; discard
            </button>
          )}
          {!recording && simReady && lastDemo && (
            <DeleteLastDemo
              key={lastDemo}
              id={lastDemo}
              onDeleted={(where) => {
                setDeleted((list) => [...list, lastDemo]);
                setNote({ text: `moved to ${where}`, title: `${lastDemo} moved to ${where}` });
              }}
              onError={(message) => setNote({ text: message, title: message })}
            />
          )}
          <span className="rg-time" role="timer" aria-label="Recording time" data-state={rec}>
            {formatClock(sim ? sim.steps * STEP_S * 1000 : 0)}
          </span>
          <button
            ref={settingsButton}
            type="button"
            className="rg-gear"
            aria-label="Settings"
            aria-expanded={drawer}
            aria-controls={DRAWER_ID}
            onClick={() => (drawer ? closeDrawer() : setDrawer(true))}
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <main className="rg-stage">
        <section className="rg-pane rg-cam" aria-label="camera">
          <div className="rg-hd">
            <InputSwitch session={session} />
            <span className="rg-hd__tools">
              {!driving && (
                <label className="rg-sens" title="Sensitivity: how far the arm moves for a hand movement (2× = half the hand motion)">
                  <span aria-hidden="true">sens</span>
                  <input
                    type="range"
                    aria-label="Sensitivity"
                    min={GAIN_MIN}
                    max={GAIN_MAX}
                    step={0.1}
                    value={settings.gain}
                    onChange={(e) => session.updateSettings({ ...settings, gain: Number(e.target.value) })}
                  />
                  <b>{settings.gain.toFixed(1)}×</b>
                </label>
              )}
              {streaming && (
                <>
                  <button type="button" className="rg-btn rg-btn--small" onClick={() => session.control("reset_scene")} disabled={!simReady || recording}>
                    Reset scene
                  </button>
                  <button type="button" className="rg-btn rg-btn--small" onClick={session.stop}>
                    Stop {driving ? input : "camera"}
                  </button>
                </>
              )}
              <span className="rg-hd__tag">{driving ? "robot frame" : "mirror"}</span>
            </span>
          </div>
          {driving ? (
            <div className="rg-cam__media">
              <DrivePanel session={session} />
              {message && <div className="rg-drive__start">{message}</div>}
            </div>
          ) : (
          <div className="rg-cam__media">
            <div className="rg-cam__frame">
              <canvas ref={session.canvas} aria-label="Your hand, mirrored, with the control region" />
              {settings.showHandArt && streaming && (
                <LazyHandArtOverlay
                  source={() => session.artHand.current}
                  trigger="events"
                  morphMs={ART_MORPH_MS}
                  cooldownMs={ART_COOLDOWN_MS}
                  onActiveChange={(active) => (session.artActive.current = active)}
                />
              )}
              {message && <div className="rg-cam__message">{message}</div>}
            </div>
          </div>
          )}
          {streaming && !driving && (
            <>
              <div className="rg-ring">
                <ResetGestureRing status={pose?.reset ?? null} showHint={false} size={32} />
              </div>
              <div className="rg-captions" aria-live="polite">
                {lost && <Caption tone="wait">Hand tracking lost. The arm holds still until your hand is back.</Caption>}
                {session.clutch && <Caption tone="wait">clutch: the arm holds still; let go to carry on from here</Caption>}
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
            <div className="rg-notice" role={relay.lastError ? "alert" : undefined}>
              {noSim && (
                <>
                  <p>The sim isn't connected. Start the Isaac sink in a terminal, then wait for the arm to appear:</p>
                  <code>{SINK_COMMAND}</code>
                </>
              )}
              {relay.lastError && <p>The relay rejected a message: {relay.lastError}</p>}
            </div>
          )}
          <Brackets />
          <div className="rg-camfoot">
            <span>
              {driving
                ? "space = grip · shift = fine · enter = record / stop & save"
                : `${settings.gripperInput === "space" ? "space" : "pinch"} = grip · ${settings.clutchKey.toLowerCase()} = clutch · ✌ hold 1.5 s = reset scene`}
            </span>
            <span className="rg-camfoot__status">
              {footStatus && <span>{footStatus}</span>}
              {!driving && session.videoNote && <span role="status">{session.videoNote}</span>}
              {fps && <span>{fps}</span>}
            </span>
          </div>
        </section>

        <div className="rg-side">
          <section className="rg-pane" aria-label="workspace" ref={twinPane}>
            <div className="rg-hd">
              <span>workspace · robot twin</span>
              <span className="rg-hd__tools">
                <label
                  className="rg-floor"
                  title="Soft floor: while you drive, the sim won't take the gripper more than ~1 cm under the bin's rim, or below the table. Each demo records whether it was on."
                >
                  <input type="checkbox" checked={session.drive.softFloor} onChange={(e) => session.updateDrive({ ...session.drive, softFloor: e.target.checked })} />
                  soft floor
                </label>
                <span className="rg-hd__tag" data-mode={twin.mode}>
                  {twin.mode}
                </span>
              </span>
            </div>
            <div className="rg-twin3d">
              <RobotTwin {...twin.view} caption={twin.caption} aids facing={facing} interactive={!mouse} />
              {twin.mode === "live" && <ContactBar contact={twin.view.contact} peakN={sim?.contactPeakN ?? null} floor={twin.floor} />}
              {mouse && !mouseLocked && (
                <div className="rg-take">
                  {/* A mouse click is taken by the pane's pointerdown; this onClick is the keyboard's (Enter, Space). */}
                  <button type="button" className="rg-take__btn" aria-label="Click here to drive with the mouse · Esc to release" onClick={(e) => e.detail === 0 && twinPane.current && session.requestMouse(twinPane.current)}>
                    <b>Click here to drive with the mouse</b>
                    <span> · Esc to release</span>
                    {!streaming && <small className="rg-take__hint">The first click starts the mouse and connects to the sim.</small>}
                  </button>
                  {session.mouseRefused && (
                    <p className="rg-take__why" role="alert">
                      {session.mouseRefused}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Brackets diagonal />
          </section>
          <div className="rg-trio">
            <section className="rg-pane" aria-label="gripper_cmd">
              <div className="rg-hd">
                <span>gripper_cmd</span>
                <span className="rg-hd__tag">pinch gap</span>
              </div>
              <GripDial pinch={hud.tracking ? hud.pinch : null} gripper={t ? hud.gripper : null} stale={stale} />
              <p className="rg-big" data-stale={stale || undefined}>
                {t ? (hud.gripper ? "closed" : "open") : "—"}
              </p>
            </section>
            <section className="rg-pane" aria-label="ee_target_z">
              <div className="rg-hd">
                <span>ee_target_z</span>
                <span className="rg-hd__tag">m</span>
              </div>
              <HeightGauge z={t?.ee[2] ?? null} stale={stale} />
              <p className="rg-big" data-stale={stale || undefined}>
                {t ? t.ee[2].toFixed(2) : "—"}
                <small>m</small>
              </p>
            </section>
            <section className="rg-pane" aria-label="ee_target_y">
              <div className="rg-hd">
                <span>ee_target_y</span>
                <span className="rg-hd__tag">m</span>
              </div>
              <SideGauge y={t?.ee[1] ?? null} stale={stale} facing={facing} />
              <p className="rg-big" data-stale={stale || undefined}>
                {t ? t.ee[1].toFixed(2) : "—"}
                <small>m</small>
              </p>
            </section>
          </div>
        </div>
      </main>

      <footer className="rg-bottom">
        <section className="rg-cell rg-cell--trace" aria-label="trace">
          <Key label="trace · height / reach / grip" unit="last 8 s" />
          <div className="rg-cell__plot">
            <Trace live={live} />
          </div>
        </section>
        <Cell label="ee_x" unit="m" value={t ? t.ee[0].toFixed(2) : "—"} stale={stale} />
        <Cell label="ee_y" unit="m" value={t ? t.ee[1].toFixed(2) : "—"} stale={stale} />
        <Cell label="recorded" unit="demos" value={String(saved)} />
        <section className="rg-cell" aria-label="episode">
          <Key label="episode" unit="state" />
          <p className="rg-state" data-state={episode.tone}>
            <span className="rg-dot" aria-hidden="true" />
            {episode.text}
          </p>
          {lastDemo && (
            <Link className="rg-review" to={`/legacy/pm/review?id=${encodeURIComponent(lastDemo)}`}>
              Review {lastDemo}
            </Link>
          )}
          {note && (
            <p className="rg-review rg-note" role="status" title={note.title}>
              {note.text}
            </p>
          )}
        </section>
      </footer>

      <RecordSettings id={DRAWER_ID} open={drawer} onClose={closeDrawer} session={session} />
    </div>
  );
}

function Key({ label, unit }: { label: string; unit: string }) {
  return (
    <p className="rg-key">
      <span>{label}</span>
      <span>{unit}</span>
    </p>
  );
}

function Cell({ label, unit, value, stale }: { label: string; unit: string; value: string; stale?: boolean }) {
  return (
    <section className="rg-cell" aria-label={label}>
      <Key label={label} unit={unit} />
      <p className="rg-value" data-stale={stale || undefined}>
        {value}
      </p>
    </section>
  );
}

/** "Delete last demo", then "Confirm: delete <id>" for CONFIRM_MS; the confirming click moves it to demos/_discarded. */
function DeleteLastDemo({ id, onDeleted, onError }: { id: string; onDeleted: (where: string) => void; onError: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirm]);

  const remove = async () => {
    setBusy(true);
    try {
      const { discarded_to } = await pmApi.discardDemo(id);
      onDeleted(discarded_to.slice(0, discarded_to.lastIndexOf("/")));
    } catch (e) {
      onError(describeError(e));
      setConfirm(false);
      setBusy(false);
    }
  };

  return confirm ? (
    <button type="button" className="rg-btn rg-btn--small" data-confirm onClick={remove} disabled={busy} aria-label={`Confirm: delete ${id}`}>
      Confirm delete
    </button>
  ) : (
    <button type="button" className="rg-btn rg-btn--small" onClick={() => setConfirm(true)} title={`Moves ${id} to demos/_discarded`}>
      Delete last demo
    </button>
  );
}

/** Corner brackets, as on the workbench selection frame: all four, or top-left and bottom-right. */
function Brackets({ diagonal = false }: { diagonal?: boolean }) {
  return <i className={diagonal ? "rg-br rg-br--diagonal" : "rg-br"} aria-hidden="true" />;
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** A caption over the camera view: the chip look, with the text as the whole message. */
function Caption({ tone, children }: { tone: "ok" | "wait"; children: ReactNode }) {
  return (
    <span className="rg-chip rg-caption" data-state={tone}>
      <span className="rg-dot" aria-hidden="true" />
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
