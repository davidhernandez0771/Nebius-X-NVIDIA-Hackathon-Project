// /pm/hand-art: the overlay playing a hand clip, so the six styles and the event sequence can
// be reviewed without a webcam or the sim. A clip saved with ClipRecorder can be loaded.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import HandArtOverlay, { useSystemReducedMotion, type HandArtStats } from "./HandArtOverlay";
import { clipDurationMs, parseClip, sampleClip, syntheticClip, type HandClip } from "./clip";
import { HAND_ART_STYLES, type HandArtStyle } from "./styleCycle";
import "./handArtPreview.css";

export const STYLE_INFO: Record<HandArtStyle, { name: string; when: string }> = {
  ink: { name: "Ink strokes", when: "idle" },
  bloom: { name: "Ink bloom", when: "grab" },
  burst: { name: "Particle burst", when: "release" },
  trail: { name: "Particle trail", when: "recording" },
  ripple: { name: "Dot ripple", when: "no hand" },
  glitch: { name: "Glitch", when: "reset" },
};

type Choice = HandArtStyle | "auto";
const CHOICES: Choice[] = ["auto", ...HAND_ART_STYLES];
const MEASURE_MS = 3500;

type SpanKind = "closed" | "recording" | "frozen" | "lost";

/** Where each Record state holds over the clip, as fractions, and where resets fire. */
function clipTracks(clip: HandClip) {
  const d = clipDurationMs(clip);
  const spans: Array<{ from: number; to: number; kind: SpanKind }> = [];
  const resets: number[] = [];
  const kinds: Array<[SpanKind, (f: HandClip["frames"][number]) => boolean]> = [
    ["recording", (f) => !!f.recording],
    ["frozen", (f) => !!f.frozen],
    ["closed", (f) => !!f.landmarks && f.gripperClosed],
    ["lost", (f) => !f.landmarks],
  ];
  for (const [kind, on] of kinds) {
    let open: number | null = null;
    clip.frames.forEach((f, i) => {
      if (on(f) && open === null) open = f.t;
      const last = i === clip.frames.length - 1;
      if (open !== null && (!on(f) || last)) {
        spans.push({ from: open / d, to: f.t / d, kind });
        open = null;
      }
    });
  }
  clip.frames.forEach((f, i) => {
    const prev = clip.frames[i - 1];
    if (prev && (f.resets ?? 0) > (prev.resets ?? 0)) resets.push(f.t / d);
  });
  return { spans, resets };
}

function describe(s: HandArtStats | null, choice: Choice, reduced: boolean): string {
  if (!s) return "Starting";
  const name = (x: HandArtStyle) => STYLE_INFO[x].name;
  if (reduced) return `${name(s.styleA)}, held still while motion is reduced`;
  if (s.morphing) return `${name(s.styleA)}, crossfading into ${name(s.styleB).toLowerCase()}`;
  if (choice !== "auto") return `${name(s.styleA)}, pinned`;
  return `${name(s.styleA)}, the ${STYLE_INFO[s.styleA].when} style`;
}

interface Measurement {
  style: HandArtStyle;
  gpuMeanMs: number | null;
  gpuP95Ms: number | null;
  cpuMeanMs: number;
}

export default function HandArtPreviewPage() {
  const [clip, setClip] = useState<HandClip>(() => syntheticClip());
  const [choice, setChoice] = useState<Choice>("auto");
  const [playing, setPlaying] = useState(true);
  const [holdClosed, setHoldClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const systemReduced = useSystemReducedMotion();
  const [reducedOverride, setReducedOverride] = useState<boolean | null>(null);
  const reduced = reducedOverride ?? systemReduced;
  const [stats, setStats] = useState<HandArtStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<number | null>(null); // index into HAND_ART_STYLES
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const duration = clipDurationMs(clip);
  const tracks = useMemo(() => clipTracks(clip), [clip]);

  // The clip clock lives in refs: the overlay polls `source` every animation frame.
  const clock = useRef({ t: 0, last: performance.now() });
  const scrub = useRef<HTMLInputElement>(null);
  const live = useRef({ clip, playing, holdClosed });
  live.current = { clip, playing, holdClosed };
  const latestStats = useRef<HandArtStats | null>(null);

  const source = () => {
    const c = clock.current;
    const now = performance.now();
    if (live.current.playing) c.t = (c.t + (now - c.last)) % clipDurationMs(live.current.clip);
    c.last = now;
    if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(Math.round(c.t));
    const s = sampleClip(live.current.clip, c.t);
    return { ...s, gripperClosed: live.current.holdClosed || s.gripperClosed };
  };

  // Measuring: each style pinned for MEASURE_MS, its frame times read at the end.
  useEffect(() => {
    if (measuring === null) return;
    const timer = setTimeout(() => {
      const s = latestStats.current;
      const style = HAND_ART_STYLES[measuring];
      setMeasurements((m) => [
        ...m,
        { style, gpuMeanMs: s?.gpuMeanMs ?? null, gpuP95Ms: s?.gpuP95Ms ?? null, cpuMeanMs: s?.cpuMeanMs ?? 0 },
      ]);
      setMeasuring(measuring + 1 < HAND_ART_STYLES.length ? measuring + 1 : null);
    }, MEASURE_MS);
    return () => clearTimeout(timer);
  }, [measuring]);

  const shownChoice: Choice = measuring !== null ? HAND_ART_STYLES[measuring] : choice;

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
          How your tracked hand is drawn on Record. Each thing you do has its own style: ink while idle, a bloom
          when you grab, a burst when you let go, a trail while recording, a ripple while your hand is out of view, a
          glitch on reset. Amber means the gripper is closed.
        </p>
      </header>

      <div className="ha-body">
        <section className="ha-stage-col" aria-label="Preview">
          <div className={`ha-stage${busy ? " ha-stage-busy" : ""}`}>
            <HandArtOverlay
              source={source}
              style={shownChoice}
              reducedMotion={reduced}
              statsKey={shownChoice}
              onStats={(s) => {
                latestStats.current = s;
                setStats(s);
              }}
            />
          </div>
          <div className="ha-timeline">
            <div className="ha-spans" aria-hidden="true">
              {tracks.spans.map((s, i) => (
                <span
                  key={i}
                  className={`ha-span ha-span-${s.kind}`}
                  style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%` }}
                />
              ))}
              {tracks.resets.map((at, i) => (
                <span key={`r${i}`} className="ha-reset" style={{ left: `${at * 100}%` }} />
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
          <ul className="ha-legend" aria-label="Timeline key">
            <li className="ha-key-recording">Recording</li>
            <li className="ha-key-closed">Gripper closed</li>
            <li className="ha-key-lost">No hand</li>
            <li className="ha-key-reset">Reset</li>
          </ul>
          <p className="ha-caption">
            {clip.source === "synthetic"
              ? `A synthetic hand, ${(duration / 1000).toFixed(0)} s loop, that runs through every event once.`
              : `Recorded clip (${clip.source}), ${(duration / 1000).toFixed(1)} s.`}
          </p>
        </section>

        <aside className="ha-controls">
          <fieldset className="ha-styles" disabled={measuring !== null}>
            <legend>Style</legend>
            {CHOICES.map((c) => {
              const showing = !!stats && c !== "auto" && (stats.styleA === c || (stats.morphing && stats.styleB === c));
              return (
                <label key={c} className="ha-style" data-showing={showing || undefined}>
                  <input type="radio" name="ha-style" value={c} checked={choice === c} onChange={() => setChoice(c)} />
                  <span className={`ha-swatch ha-swatch-${c}`} aria-hidden="true" />
                  <span className="ha-style-name">{c === "auto" ? "Follow the events" : STYLE_INFO[c].name}</span>
                  {c !== "auto" && <span className="ha-style-when">{STYLE_INFO[c].when}</span>}
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
              <input type="checkbox" checked={busy} onChange={(e) => setBusy(e.target.checked)} />
              Busy background
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
              <dd>{describe(stats, shownChoice, reduced)}</dd>
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
              <dt>CPU per frame</dt>
              <dd className="ha-num">
                {stats ? `${stats.cpuMeanMs.toFixed(2)} ms mean, ${stats.cpuP95Ms.toFixed(2)} ms p95` : "–"}
              </dd>
            </div>
            <div>
              <dt>Frame rate, size</dt>
              <dd className="ha-num">{stats ? `${stats.fps.toFixed(0)} fps, ${stats.width} × ${stats.height} px` : "–"}</dd>
            </div>
          </dl>

          <div className="ha-measure">
            <button
              type="button"
              className="ha-btn"
              disabled={measuring !== null}
              onClick={() => {
                setMeasurements([]);
                setMeasuring(0);
              }}
            >
              {measuring !== null
                ? `Measuring ${STYLE_INFO[HAND_ART_STYLES[measuring]].name.toLowerCase()}…`
                : "Measure each style"}
            </button>
            {measurements.length > 0 && (
              <table className="ha-table">
                <caption>GPU and CPU time per frame, {MEASURE_MS / 1000} s per style</caption>
                <thead>
                  <tr>
                    <th scope="col">Style</th>
                    <th scope="col">GPU mean</th>
                    <th scope="col">GPU p95</th>
                    <th scope="col">CPU mean</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((m) => (
                    <tr key={m.style}>
                      <th scope="row">{STYLE_INFO[m.style].name}</th>
                      <td className="ha-num">{m.gpuMeanMs != null ? `${m.gpuMeanMs.toFixed(2)} ms` : "–"}</td>
                      <td className="ha-num">{m.gpuP95Ms != null ? `${m.gpuP95Ms.toFixed(2)} ms` : "–"}</td>
                      <td className="ha-num">{`${m.cpuMeanMs.toFixed(2)} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
