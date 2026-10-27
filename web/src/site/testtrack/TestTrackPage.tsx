// The test track (/test-track): watch simulations that already ran. Pick a source (the camera policy's final test,
// first and the default; the RL teacher's gate, its replay check, the distillation's round 0) and a run, and the
// robot twin plays back what Isaac recorded, with SANT's verdict and the run's key facts as holo tags. A replay,
// never live physics: every pose is from the run's own files (web/public/test-track-data, scripts/build_test_track.py).
// A clean arena, an orbit camera, keyboard shortcuts and a boot console, after Pollen's Microduck simulator.
// ?source=<id>&run=<seed>&show=all|ok|failed is the URL state; ?boot=1 keeps the boot console up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMotion } from "../../sant/motion/MotionProvider";
import { RobotTwin, type TwinTrail } from "../../twin";
import type { Vec3 } from "../../twin/types";
import { stateAt } from "../../twin/replay";
import { useAsync, type Async } from "../data/hooks";
import { HoloPage, HoloPanel, HoloRule, HoloTag } from "../holo/Holo";
import { fetchIndex, fetchRun, type Fetch } from "./api";
import {
  advance,
  contactAt,
  contactsAt,
  END_HOLD_S,
  estimateText,
  factTags,
  keyAction,
  neighbourRun,
  nextSpeed,
  parseShow,
  reasonText,
  runDuration,
  seedsText,
  shownRuns,
  SHOWS,
  SHORTCUTS,
  stepAt,
  summaryText,
  verdictText,
  type RunRow,
  type Show,
  type Source,
  type TrackIndex,
  type TrackRun,
} from "./model";
import "./testtrack.css";

// The paths' colours: the hand in the live teal, the cube in its own red (dashed where it is an estimate).
const TRAIL = { hand: "#19F5C2", cube: "#FF8A5C" };

/** What the wide camera keeps in view: the robot (its base and its height), the cube's and the hand's paths, the bin. */
function framing(run: TrackRun): Vec3[] {
  return [[0, 0, 0], [0, 0, 0.85], run.bin.pos, ...(run.cubePos ?? []), ...(run.handPos ?? [])];
}

/** A looping clock at `speed`, ticking at most 30 times a second while playing. */
function useTrackClock(duration: number, playing: boolean, speed: number): [number, (t: number) => void] {
  const [t, setT] = useState(0);
  const now = useRef(0);
  useEffect(() => {
    if (!playing || duration <= 0) return;
    let raf = 0;
    let last: number | null = null;
    let shown = 0;
    const tick = (ms: number) => {
      now.current = advance(now.current, last === null ? 0 : (ms - last) / 1000, speed, duration, END_HOLD_S);
      last = ms;
      if (ms - shown >= 1000 / 30 - 1) {
        shown = ms;
        setT(now.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, speed]);
  const seek = useCallback(
    (v: number) => {
      now.current = Math.max(0, Math.min(duration, v));
      setT(now.current);
    },
    [duration],
  );
  return [t, seek];
}

function BootConsole({ index, run }: { index: Async<TrackIndex>; run: Async<TrackRun> | null }) {
  const lines: { text: string; state: "ok" | "wait" | "fail" }[] = [{ text: "SANT test track · replays of runs Isaac already recorded", state: "ok" }];
  if (index.state === "loading") lines.push({ text: "reading the index…", state: "wait" });
  if (index.state === "error") lines.push({ text: `the index didn't load: ${index.message}`, state: "fail" });
  if (index.state === "ok") {
    const runs = index.value.sources.reduce((n, s) => n + s.runs.length, 0);
    const played = index.value.sources.reduce((n, s) => n + s.runs.filter((r) => r.recorded).length, 0);
    lines.push({ text: `index · ${index.value.sources.length} sources · ${runs} runs · ${played} replays`, state: "ok" });
    if (run?.state === "loading") lines.push({ text: "loading the run…", state: "wait" });
    if (run?.state === "error") lines.push({ text: `the run didn't load: ${run.message}`, state: "fail" });
    if (run?.state === "ok") lines.push({ text: `run ${run.value.demoId} · ${run.value.nSteps} steps at ${run.value.fps} Hz`, state: "ok" });
  }
  return (
    <ol className="tt-boot" aria-label="Loading" aria-live="polite">
      {lines.map((l, i) => (
        <li key={i} data-state={l.state}>
          <span aria-hidden="true">{l.state === "ok" ? "[ ok ]" : l.state === "fail" ? "[fail]" : "[ .. ]"}</span> {l.text}
        </li>
      ))}
    </ol>
  );
}

function SourcePicker({ sources, current, onPick }: { sources: Source[]; current: Source; onPick: (id: string) => void }) {
  return (
    <nav className="tt-sources" aria-label="Sources">
      <ol>
        {sources.map((s, i) => (
          <li key={s.id}>
            <button type="button" className="tt-source" aria-pressed={s.id === current.id} onClick={() => onPick(s.id)}>
              <span className="tt-source__key" aria-hidden="true">
                {i + 1}
              </span>
              <span className="tt-source__title">{s.title}</span>
              {/* the final test's title already carries its count */}
              {!s.title.includes(`${s.summary.successes}/${s.summary.n}`) && (
                <span className="tt-source__count">
                  {s.summary.successes}/{s.summary.n}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const SHOW_WORDS: Record<Show, string> = { all: "All", ok: "Verified", failed: "Failed" };

const runLabel = (r: RunRow) =>
  `Seed ${r.seed}: ${r.success ? "verified" : `failed, ${reasonText(r.reasons, r.endedBy)}`}${r.recorded ? "" : ", no replay saved"}`;

function RunGrid({ source, show, active, onPick, onShow }: { source: Source; show: Show; active: string; onPick: (id: string) => void; onShow: (s: Show) => void }) {
  const failedRuns = source.runs.filter((r) => !r.success);
  const counts: Record<Show, number> = { all: source.runs.length, ok: source.runs.length - failedRuns.length, failed: failedRuns.length };
  const runs = shownRuns(source.runs, show);
  return (
    <section className="tt-runs" aria-labelledby="tt-runs-title">
      <HoloRule label={<span id="tt-runs-title">Runs · {seedsText(source)}{failedRuns.length ? ` · ${failedRuns.length} failed` : ""}</span>} />
      {failedRuns.length > 0 && (
        <div className="tt-show" role="group" aria-label="Show runs">
          {SHOWS.map((s) => (
            <button key={s} type="button" className="tt-show__btn" data-show={s} aria-pressed={show === s} onClick={() => onShow(s)}>
              {SHOW_WORDS[s]} {counts[s]}
            </button>
          ))}
        </div>
      )}
      <ul className="tt-runs__grid" aria-label="Runs">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="tt-run"
              data-ok={r.success}
              data-recorded={r.recorded}
              aria-pressed={r.id === active}
              aria-label={runLabel(r)}
              title={runLabel(r)}
              onClick={() => onPick(r.id)}
            >
              {r.seed}
            </button>
          </li>
        ))}
      </ul>
      {failedRuns.length > 0 && show !== "ok" && (
        <>
          <HoloRule label="Why runs failed" />
          <ul className="tt-fails" aria-label="Why runs failed">
            {failedRuns.map((r) => (
              <li key={r.id} className="tt-fail">
                <button type="button" className="tt-fail__seed" aria-pressed={r.id === active} aria-label={`Seed ${r.seed}`} onClick={() => onPick(r.id)}>
                  {r.seed}
                </button>
                <span className="tt-fail__why">{reasonText(r.reasons, r.endedBy)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Tags({ row, run, step, source }: { row: RunRow; run: TrackRun | null; step: number; source: Source }) {
  const facts = run?.facts ?? row;
  const tags = factTags(facts, run?.cubeSource ?? row.cubeSource);
  const force = run ? contactAt(run, step) : null;
  const touching = run ? contactsAt(run, step) : null;
  return (
    <div className="tt-tags">
      <HoloPanel as="div" className="tt-verdict" state={facts.success ? "pass" : "fail"} role="status">
        <HoloTag dot>SANT · seed {row.seed}</HoloTag>
        <p className="tt-verdict__text">
          <span aria-hidden="true">{facts.success ? "✓ " : "✕ "}</span>
          {verdictText(facts, row.endedBy)}
        </p>
        {row.inEnv !== null && <p className="tt-verdict__sub">Teacher's own check: {row.inEnv ? "pass" : "fail"} · replay agrees: {row.inEnv === facts.success ? "yes" : "no"}</p>}
      </HoloPanel>
      {tags.length > 0 && (
        <HoloPanel as="dl" className="tt-facts">
          {tags.map((t) => (
            <div key={t.label} className="tt-fact">
              <dt>
                <HoloTag>{t.label}</HoloTag>
              </dt>
              <dd>{t.value}</dd>
            </div>
          ))}
          {force !== null && (
            <div className="tt-fact">
              <dt>
                <HoloTag>Arm contact now</HoloTag>
              </dt>
              <dd>{force.toFixed(1)} N</dd>
            </div>
          )}
          {touching !== null && (
            <div className="tt-fact">
              <dt>
                <HoloTag>Touching now</HoloTag>
              </dt>
              <dd>{touching.length ? touching.join(", ") : "nothing"}</dd>
            </div>
          )}
        </HoloPanel>
      )}
      {(run?.cubeSource ?? row.cubeSource) === "estimated" && source.cubeEstimate && <p className="tt-estimate">{estimateText(source.cubeEstimate)}</p>}
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <HoloPanel as="div" className="tt-help" role="dialog" aria-modal="false" aria-labelledby="tt-help-title">
      <h2 id="tt-help-title" className="tt-help__title">
        Keyboard
      </h2>
      <dl>
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
      <p className="tt-help__mouse">Drag to turn the camera, scroll or pinch to zoom.</p>
      <button ref={close} type="button" className="tt-btn" onClick={onClose}>
        Close
      </button>
    </HoloPanel>
  );
}

export default function TestTrackPage({ fetchImpl }: { fetchImpl?: Fetch }) {
  const [params, setParams] = useSearchParams();
  const index = useAsync("tt:index", () => fetchIndex(fetchImpl));
  const sources = index.state === "ok" ? index.value.sources : [];
  const source = sources.find((s) => s.id === params.get("source")) ?? sources[0] ?? null;
  // The grid's filter; a source with no failed run always shows all of them.
  const show: Show = source?.runs.some((r) => !r.success) ? parseShow(params.get("show")) : "all";
  const visible = source ? shownRuns(source.runs, show) : [];
  // With no run asked for, open on the first verified replay the filter shows (a viewer sees it work first; the
  // failures are marked and listed beside it), else its first replay.
  const firstPlayed = visible.find((r) => r.recorded && r.success) ?? visible.find((r) => r.recorded) ?? visible[0] ?? source?.runs[0] ?? null;
  const row = source?.runs.find((r) => r.id === params.get("run")) ?? firstPlayed;
  const navRuns = visible.length ? visible : (source?.runs ?? []);
  const run = useAsync(row?.recorded && row.file ? `tt:${row.file}` : null, () => fetchRun(row!.file!, fetchImpl));
  const ready = run.state === "ok" && row?.recorded ? run.value : null;

  const { reduced } = useMotion();
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);
  const [speed, setSpeed] = useState(1);
  const [viewKey, setViewKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const duration = ready ? runDuration(ready) : 0;
  const [t, seek] = useTrackClock(duration, playing, speed);
  const step = ready ? stepAt(t, ready) : 0;
  const twin = useMemo(() => {
    if (!ready) return null;
    const s = stateAt(ready, step);
    // the final test recorded the cube's rotation too: a dropped cube tumbles as it did in Isaac
    return ready.cubeQuats && s.cube ? { ...s, cube: { ...s.cube, quat: ready.cubeQuats[Math.min(step, ready.nSteps - 1)] } } : s;
  }, [ready, step]);
  // One frame per run (a new array every step would put the camera back each time).
  const frame = useMemo(() => (ready ? framing(ready) : null), [ready]);
  const trails = useMemo<TwinTrail[] | null>(() => {
    if (!ready || !showTrails) return null;
    const out: TwinTrail[] = [];
    if (ready.handPos) out.push({ points: ready.handPos, upto: step, color: TRAIL.hand });
    if (ready.cubePos) out.push({ points: ready.cubePos, upto: step, color: TRAIL.cube, dashed: ready.cubeSource === "estimated" });
    return out;
  }, [ready, step, showTrails]);
  useEffect(() => seek(0), [row?.id, source?.id, seek]);

  const go = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = keyAction(e);
      if (!a) return;
      if (a.type === "close") return setHelp(false);
      if (a.type === "help") return setHelp((h) => !h);
      if (a.type === "resetView") return setViewKey((k) => k + 1);
      if (a.type === "trails") return setShowTrails((v) => !v);
      if (a.type === "speed") return setSpeed((s) => nextSpeed(s, a.dir));
      if (a.type === "source") {
        if (sources[a.index]) go({ source: sources[a.index].id, run: null, show: null });
        return;
      }
      if (!source || !row) return;
      if (a.type === "run") return go({ source: source.id, run: neighbourRun(navRuns, row.id, a.dir) });
      if (!ready) return;
      e.preventDefault(); // Space would scroll the page, the arrows too
      if (a.type === "toggle") setPlaying((p) => !p);
      if (a.type === "step") {
        setPlaying(false);
        seek(Math.max(0, Math.min(ready.nSteps - 1, step + a.by)) / ready.fps);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sources, source, row, navRuns, ready, step, seek, go]);

  // The boot console shows while things load; ?boot=1 keeps it up (as on the Microduck simulator).
  const booting = params.get("boot") === "1" || index.state !== "ok" || (row?.recorded && run.state !== "ok");

  return (
    <HoloPage
      title="The test track"
      here="test-track"
      actions={
        <button type="button" className="tt-btn tt-btn--quiet" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-keyshortcuts="?">
          Keys <kbd>?</kbd>
        </button>
      }
    >
      <div className="tt">
        <p className="tt-lede">
          Runs that already happened in Isaac Sim, played back step by step from what the simulator recorded: the robot's joints, the gripper,
          the cube, and the verdict SANT's physics check gave each one. Nothing here is simulated in your browser.
        </p>
        {index.state === "ok" && source && row ? (
          <div className="tt-layout">
            <HoloPanel as="aside" className="tt-side">
              <SourcePicker sources={sources} current={source} onPick={(id) => go({ source: id, run: null, show: null })} />
              <p className="tt-summary">{summaryText(source)}</p>
              <p className="tt-what">{source.what}</p>
              <RunGrid
                source={source}
                show={show}
                active={row.id}
                onPick={(id) => go({ source: source.id, run: id })}
                // the run on screen stays if the new filter shows it; else the filter opens on its first run
                onShow={(s) => go({ source: source.id, show: s === "all" ? null : s, run: shownRuns(source.runs, s).some((r) => r.id === row.id) ? row.id : null })}
              />
              {/* how the source was put together, after the runs so the grid sits high in the panel */}
              {source.note && <p className="tt-note">{source.note}</p>}
              {source.checkpoint && (
                <p className="tt-ckpt">
                  <HoloTag>Checkpoint</HoloTag> <code>{source.checkpoint.split(/[\\/]/).slice(-3).join("/")}</code>
                </p>
              )}
            </HoloPanel>
            <section className="tt-stage" aria-label={`Seed ${row.seed}`}>
              <div className="tt-arena">
                {ready && twin ? (
                  <RobotTwin {...twin} base={ready.base} interactive viewKey={viewKey} look="studio" cubeColor="red" framePoints={frame} trails={trails} caption={`Isaac Sim replay · seed ${row.seed} · step ${step + 1} of ${ready.nSteps}`} />
                ) : (
                  <div className="tt-arena__empty">
                    {!row.recorded ? (
                      <p>
                        This rollout saved no replay: the distillation keeps only the runs that pass. It ended {row.endedBy === "time_limit" ? "at the time limit" : "early"} after{" "}
                        {row.steps ?? "?"} steps.
                      </p>
                    ) : null}
                  </div>
                )}
                {booting && <BootConsole index={index} run={row.recorded ? run : null} />}
                {help && <Help onClose={() => setHelp(false)} />}
              </div>
              <HoloPanel as="div" className="tt-transport">
                <button type="button" className="tt-btn" onClick={() => setPlaying((p) => !p)} disabled={!ready} aria-keyshortcuts="Space">
                  {playing ? "Pause" : "Play"}
                </button>
                <label className="tt-scrub">
                  <span className="sant-sr-only">Time</span>
                  <input type="range" min={0} max={duration || 1} step={0.02} value={Math.min(t, duration)} disabled={!ready} onChange={(e) => seek(Number(e.target.value))} />
                </label>
                <span className="tt-time">
                  {Math.min(t, duration).toFixed(2)} / {duration.toFixed(2)} s
                </span>
                <span className="tt-speed" role="group" aria-label="Speed">
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => setSpeed((s) => nextSpeed(s, -1))} aria-label="Slower" aria-keyshortcuts="[">
                    −
                  </button>
                  <span className="tt-speed__now" aria-live="polite">
                    {speed}×
                  </span>
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => setSpeed((s) => nextSpeed(s, 1))} aria-label="Faster" aria-keyshortcuts="]">
                    +
                  </button>
                </span>
                <span className="tt-nav">
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => go({ source: source.id, run: neighbourRun(navRuns, row.id, -1) })} aria-keyshortcuts="J">
                    ‹ Run
                  </button>
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => go({ source: source.id, run: neighbourRun(navRuns, row.id, 1) })} aria-keyshortcuts="K">
                    Run ›
                  </button>
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => setViewKey((k) => k + 1)} aria-keyshortcuts="R">
                    Reset view
                  </button>
                  <button type="button" className="tt-btn tt-btn--quiet" onClick={() => setShowTrails((v) => !v)} aria-pressed={showTrails} aria-keyshortcuts="T">
                    Paths
                  </button>
                </span>
              </HoloPanel>
              {/* After the transport, so a phone has the controls right under the arena; a desktop lays them over it. */}
              <Tags row={row} run={ready} step={step} source={source} />
            </section>
          </div>
        ) : (
          <div className="tt-layout tt-layout--boot">
            <BootConsole index={index} run={null} />
          </div>
        )}
        {index.state === "ok" && <p className="tt-built">Built from the runs' own files on {new Date(index.value.built).toLocaleString()}.</p>}
      </div>
    </HoloPage>
  );
}
