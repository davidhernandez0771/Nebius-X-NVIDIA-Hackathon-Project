// The LOOK clip: the same scene, two robots side by side, on one clock. Left, the policy that imitated the 10 raw
// mouse demos (0/40); right, SANT's v2 camera policy built from the same 10 demos (30/40). Both play back what Isaac
// recorded (web/public/look-clip, scripts/build_look_clip.py), drawn by the test track's twin; nothing is simulated
// in the browser. Embeddable: the hero and /site/results mount <LookClip />, /look shows it alone.
//
// The pairs are a labelled cherry-pick: the seeds where both policies have a trace, the raw policy failed and v2
// succeeded (the raw policy failed all 40 of its counted runs, so that keeps v2's successes). The pick is written in
// the data (index.json `pick`) and shown under the clip; v2's 10 failures are on the test track.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useMotion } from "../../sant/motion/MotionProvider";
import { RobotTwin, type TwinTrail } from "../../twin";
import { stateAt } from "../../twin/replay";
import { useAsync } from "../data/hooks";
import type { TrackRun } from "../testtrack/model";
import { useTrackClock } from "../testtrack/useTrackClock";
import { fetchClip, fetchClipRun, type Fetch } from "./api";
import { CLIP_HOLD_S, clipDuration, clipStep, headlineText, seedRange, sharedFrame, SIDE_IDS, standingText, statusText, type Clip, type Pair, type SideId } from "./model";
import "./lookclip.css";

const TRAIL = { hand: "#19F5C2", cube: "#FF8A5C" };

export type LookClipProps = {
  fetchImpl?: Fetch;
  /** The pair to play (a seed in the clip); default the first. */
  seed?: number | null;
  /** Called when the viewer picks another scene (the page keeps it in the URL). Without it the clip keeps its own. */
  onSeed?: (seed: number) => void;
  /** Drag to turn and scroll to zoom the two views (default off, so an embed never catches the page's scroll). */
  interactive?: boolean;
  /** The caption's heading level where it is mounted (default h2). */
  headingLevel?: 2 | 3;
  className?: string;
};

/** True while the element is on screen (always true where IntersectionObserver is missing). */
function useOnScreen<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

function Robot({ sid, clip, pair, run, t, revealAt, frame, interactive }: { sid: SideId; clip: Clip; pair: Pair; run: TrackRun | null; t: number; revealAt: number; frame: [number, number, number][] | null; interactive: boolean }) {
  const side = clip.sides[sid];
  const row = pair[sid];
  const step = run ? clipStep(t, run) : 0;
  const twin = useMemo(() => {
    if (!run) return null;
    const s = stateAt(run, step);
    return run.cubeQuats && s.cube ? { ...s, cube: { ...s.cube, quat: run.cubeQuats[Math.min(step, run.nSteps - 1)] } } : s;
  }, [run, step]);
  const trails = useMemo<TwinTrail[] | null>(() => {
    if (!run) return null;
    const out: TwinTrail[] = [];
    if (run.handPos) out.push({ points: run.handPos, upto: step, color: TRAIL.hand });
    if (run.cubePos) out.push({ points: run.cubePos, upto: step, color: TRAIL.cube });
    return out;
  }, [run, step]);
  const revealed = run !== null && t >= Math.min(revealAt, run.nSteps / run.fps);
  return (
    <figure className="lc-side" data-side={sid} data-ok={revealed ? row.success : undefined} aria-label={`${side.title}: ${headlineText(side)} on ${seedRange(side)}`}>
      <figcaption className="lc-side__head">
        <span className="lc-side__title">{side.title}</span>
        <span className="lc-side__count">
          {headlineText(side)}
          <span className="lc-side__seeds"> on {seedRange(side)}</span>
        </span>
      </figcaption>
      <div className="lc-arena">
        {run && twin ? (
          <RobotTwin {...twin} base={run.base} interactive={interactive} look="studio" cubeColor="red" framePoints={frame} trails={trails} caption={`Isaac Sim · seed ${pair.seed} · ${(step / run.fps).toFixed(1)} s`} />
        ) : (
          <div className="lc-arena__empty" aria-busy="true" />
        )}
      </div>
      <p className="lc-status" data-ok={revealed ? row.success : undefined}>
        {run ? statusText(row, run, t, revealAt) : "Loading the run…"}
      </p>
    </figure>
  );
}

export function LookClip({ fetchImpl, seed = null, onSeed, interactive = false, headingLevel = 2, className }: LookClipProps) {
  const clip = useAsync("lc:index", () => fetchClip(fetchImpl));
  const [own, setOwn] = useState<number | null>(null);
  const pairs = clip.state === "ok" ? clip.value.pairs : [];
  const pair = pairs.find((p) => p.seed === (onSeed ? seed : (own ?? seed))) ?? pairs[0] ?? null;
  const raw = useAsync(pair ? `lc:${pair.raw.file}` : null, () => fetchClipRun(pair!.raw.file, fetchImpl));
  const v2 = useAsync(pair ? `lc:${pair.v2.file}` : null, () => fetchClipRun(pair!.v2.file, fetchImpl));
  const rawRun = raw.state === "ok" ? raw.value : null;
  const v2Run = v2.state === "ok" ? v2.value : null;
  const runs = { raw: rawRun, v2: v2Run };
  const ready = rawRun !== null && v2Run !== null;

  const duration = rawRun && v2Run ? clipDuration(rawRun, v2Run) : 0;
  const revealAt = rawRun && v2Run ? Math.min(rawRun.nSteps / rawRun.fps, v2Run.nSteps / v2Run.fps) : Infinity;
  // One frame for both views (the same camera on the same scene), made once per pair.
  const frame = useMemo(() => (rawRun && v2Run ? sharedFrame(rawRun, v2Run) : null), [rawRun, v2Run]);

  const { reduced } = useMotion();
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);
  const [box, onScreen] = useOnScreen<HTMLElement>();
  const [clock, seek] = useTrackClock(duration, playing && onScreen, 1, CLIP_HOLD_S);
  const t = Math.min(clock, duration); // the hold rests on the last frame: neither robot moves on
  // A new pair starts from the top; with reduced motion it rests on its last frame, the result, instead.
  useEffect(() => {
    if (duration > 0) seek(reduced ? duration : 0);
  }, [pair?.seed, duration, reduced, seek]);

  const pick = (s: number) => (onSeed ? onSeed(s) : setOwn(s));
  const H = headingLevel === 3 ? "h3" : "h2";
  const failed = clip.state === "error" || raw.state === "error" || v2.state === "error";

  return (
    <section ref={box} className={`lc${className ? ` ${className}` : ""}`} aria-labelledby="lc-caption" data-state={ready ? "ready" : failed ? "error" : "loading"}>
      <header className="lc-head">
        <p className="lc-kicker">
          {clip.state === "ok" ? clip.value.label : "Illustrative replay"} · picked to show the difference{pair ? ` · seed ${pair.seed}` : ""}
        </p>
        <H id="lc-caption" className="lc-caption">
          {clip.state === "ok" ? clip.value.caption : "Same 10 demos. Same scene."}
        </H>
      </header>
      {failed ? (
        <p className="lc-missing">
          The side-by-side replay didn't load. <Link to="/test-track">The test track</Link> replays the final test's 40 runs.
        </p>
      ) : clip.state === "ok" && pair ? (
        <>
          <div className="lc-pair">
            {SIDE_IDS.map((sid) => (
              <Robot key={sid} sid={sid} clip={clip.value} pair={pair} run={runs[sid]} t={t} revealAt={revealAt} frame={frame} interactive={interactive} />
            ))}
          </div>
          <div className="lc-controls">
            <button type="button" className="lc-btn" onClick={() => setPlaying((p) => !p)} disabled={!ready}>
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="lc-btn lc-btn--quiet"
              onClick={() => {
                seek(0);
                setPlaying(true);
              }}
              disabled={!ready}
            >
              From the start
            </button>
            <span className="lc-time" aria-hidden="true">
              {t.toFixed(1)} s
            </span>
            {pairs.length > 1 && (
              <span className="lc-scenes" role="group" aria-label="Scenes">
                {pairs.map((p, i) => (
                  <button key={p.seed} type="button" className="lc-btn lc-btn--quiet" aria-pressed={p.seed === pair.seed} aria-label={`Scene ${i + 1}, seed ${p.seed}`} onClick={() => pick(p.seed)}>
                    {i + 1}
                  </button>
                ))}
              </span>
            )}
          </div>
          <details className="lc-how">
            <summary>How these runs were picked</summary>
            <p>{clip.value.pick}</p>
            <ul>
              {SIDE_IDS.map((sid) => (
                <li key={sid}>
                  <strong>{clip.value.sides[sid].title}:</strong> {standingText(pair[sid].standing, pair.seed, clip.value.sides[sid])}
                </li>
              ))}
            </ul>
            <p>
              Both robots start from the same pose in the same scene (the seed places the cube and the bin), and every pose is what Isaac Sim recorded at 50 Hz. The clip plays until the
              quicker robot is done and a moment after; each verdict is SANT's for that robot's whole run.{" "}
              <Link to="/test-track">All 40 runs of the final test</Link>, failures included.
            </p>
          </details>
        </>
      ) : (
        <div className="lc-pair" aria-busy="true">
          <div className="lc-arena lc-arena--wait" />
          <div className="lc-arena lc-arena--wait" />
        </div>
      )}
    </section>
  );
}

export default LookClip;
