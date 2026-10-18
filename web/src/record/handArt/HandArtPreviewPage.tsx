// /pm/hand-art: the overlay playing a hand clip, with a style picker, so the look can be
// reviewed without a webcam or the sim. A clip saved with ClipRecorder can be loaded.

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import HandArtOverlay, { useSystemReducedMotion, type HandArtStats } from "./HandArtOverlay";
import { clipDurationMs, parseClip, sampleClip, syntheticClip, type HandClip } from "./clip";
import { HAND_ART_STYLES, type HandArtStyle } from "./styleCycle";
import "./handArtPreview.css";

const STYLE_NAMES: Record<HandArtStyle, string> = {
  ascii: "Text marks",
  bayer: "Dither",
  halftone: "Halftone",
  particles: "Particles",
  lines: "Glow lines",
};

type Choice = HandArtStyle | "auto";
const CHOICES: Choice[] = ["auto", ...HAND_ART_STYLES];

/** Spans of the clip, as fractions, where the gripper is closed or no hand is tracked. */
function clipSpans(clip: HandClip) {
  const d = clipDurationMs(clip);
  const spans: Array<{ from: number; to: number; kind: "closed" | "lost" }> = [];
  clip.frames.forEach((f, i) => {
    const next = clip.frames[i + 1];
    if (!next) return;
    const kind = !f.landmarks ? "lost" : f.gripperClosed ? "closed" : null;
    if (!kind) return;
    const last = spans[spans.length - 1];
    if (last && last.kind === kind && last.to === f.t / d) last.to = next.t / d;
    else spans.push({ from: f.t / d, to: next.t / d, kind });
  });
  return spans;
}

function describe(s: HandArtStats | null, choice: Choice, reduced: boolean): string {
  if (!s) return "Starting";
  if (reduced) return `${STYLE_NAMES[s.styleA]}, held still while motion is reduced`;
  if (s.morphing) return `${STYLE_NAMES[s.styleA]}, morphing into ${STYLE_NAMES[s.styleB].toLowerCase()}`;
  return choice === "auto" ? `${STYLE_NAMES[s.styleA]}, cycling` : STYLE_NAMES[s.styleA];
}

export default function HandArtPreviewPage() {
  const [clip, setClip] = useState<HandClip>(() => syntheticClip());
  const [choice, setChoice] = useState<Choice>("auto");
  const [playing, setPlaying] = useState(true);
  const [holdClosed, setHoldClosed] = useState(false);
  const systemReduced = useSystemReducedMotion();
  const [reducedOverride, setReducedOverride] = useState<boolean | null>(null);
  const reduced = reducedOverride ?? systemReduced;
  const [stats, setStats] = useState<HandArtStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const duration = clipDurationMs(clip);
  const spans = useMemo(() => clipSpans(clip), [clip]);

  // The clip clock lives in refs: the overlay polls `source` every animation frame.
  const clock = useRef({ t: 0, last: performance.now() });
  const scrub = useRef<HTMLInputElement>(null);
  const live = useRef({ clip, playing, holdClosed });
  live.current = { clip, playing, holdClosed };

  const source = () => {
    const c = clock.current;
    const now = performance.now();
    if (live.current.playing) c.t = (c.t + (now - c.last)) % clipDurationMs(live.current.clip);
    c.last = now;
    if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(Math.round(c.t));
    const s = sampleClip(live.current.clip, c.t);
    return { landmarks: s.landmarks, gripperClosed: live.current.holdClosed || s.gripperClosed };
  };

  const onLoad = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setClip(parseClip(JSON.parse(await file.text())));
      clock.current.t = 0;
      setLoadError(null);
    } catch (err) {
      setLoadError(`${file.name} isn't a hand clip. ${err instanceof Error ? err.message : ""}`.trim());
    }
  };

  return (
    <main className="ha-page">
      <header className="ha-head">
        <h1>Hand art</h1>
        <p>
          The overlay that draws your tracked hand on Record. It changes style every few seconds and each time the
          gripper opens or closes; amber means closed.
        </p>
      </header>

      <div className="ha-body">
        <section className="ha-stage-col" aria-label="Preview">
          <div className="ha-stage">
            <HandArtOverlay source={source} style={choice} reducedMotion={reduced} onStats={setStats} />
          </div>
          <div className="ha-timeline">
            <div className="ha-spans" aria-hidden="true">
              {spans.map((s, i) => (
                <span
                  key={i}
                  className={`ha-span ha-span-${s.kind}`}
                  style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%` }}
                />
              ))}
            </div>
            <input
              ref={scrub}
              type="range"
              min={0}
              max={duration}
              step={10}
              defaultValue={0}
              aria-label="Clip position"
              onChange={(e) => (clock.current.t = Number(e.target.value))}
            />
          </div>
          <p className="ha-caption">
            {clip.source === "synthetic"
              ? `A synthetic hand, ${(duration / 1000).toFixed(0)} s loop: open, pinch, release, fist, release. Amber on the bar marks the gripper closed.`
              : `Recorded clip (${clip.source}), ${(duration / 1000).toFixed(1)} s. Amber marks the gripper closed, grey marks no hand.`}
          </p>
        </section>

        <aside className="ha-controls">
          <fieldset className="ha-styles">
            <legend>Style</legend>
            {CHOICES.map((c) => {
              const showing = !!stats && c !== "auto" && (stats.styleA === c || (stats.morphing && stats.styleB === c));
              return (
                <label key={c} className="ha-style" data-showing={showing || undefined}>
                  <input type="radio" name="ha-style" value={c} checked={choice === c} onChange={() => setChoice(c)} />
                  <span className={`ha-swatch ha-swatch-${c}`} aria-hidden="true" />
                  <span className="ha-style-name">{c === "auto" ? "Auto" : STYLE_NAMES[c]}</span>
                  {showing && <span className="ha-visually-hidden"> (showing)</span>}
                </label>
              );
            })}
          </fieldset>

          <div className="ha-actions">
            <button type="button" className="ha-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
              {playing ? "Pause clip" : "Play clip"}
            </button>
            <label className="ha-check">
              <input type="checkbox" checked={holdClosed} onChange={(e) => setHoldClosed(e.target.checked)} />
              Hold gripper closed
            </label>
            <label className="ha-check">
              <input type="checkbox" checked={reduced} onChange={(e) => setReducedOverride(e.target.checked)} />
              Reduce motion
            </label>
            <label className="ha-btn ha-file">
              Load a recorded clip
              <input type="file" accept=".json,application/json" onChange={onLoad} />
            </label>
            {clip.source !== "synthetic" && (
              <button type="button" className="ha-btn ha-btn-quiet" onClick={() => setClip(syntheticClip())}>
                Back to the synthetic hand
              </button>
            )}
            {loadError && (
              <p className="ha-error" role="alert">
                {loadError}
              </p>
            )}
          </div>

          <dl className="ha-readout" aria-live="off">
            <div>
              <dt>Now</dt>
              <dd>{describe(stats, choice, reduced)}</dd>
            </div>
            <div>
              <dt>CPU per frame</dt>
              <dd className="ha-num">
                {stats ? `${stats.cpuMeanMs.toFixed(2)} ms mean, ${stats.cpuP95Ms.toFixed(2)} ms p95` : "–"}
              </dd>
            </div>
            <div>
              <dt>GPU per frame</dt>
              <dd className="ha-num">
                {stats?.gpuMeanMs != null
                  ? `${stats.gpuMeanMs.toFixed(2)} ms mean, ${stats.gpuP95Ms!.toFixed(2)} ms p95`
                  : stats
                    ? "Not measurable in this browser"
                    : "–"}
              </dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd className="ha-num">{stats ? `${stats.fps.toFixed(0)} fps` : "–"}</dd>
            </div>
            <div>
              <dt>Drawn at</dt>
              <dd className="ha-num">{stats ? `${stats.width} × ${stats.height} px` : "–"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
