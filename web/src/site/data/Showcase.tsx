// One experiment, demo by demo: pick a demo, see two of its views side by side (what the human did, the physics
// re-run, what SANT repaired, a multiplied variant) on one clock, what the repair changed, and its variants.
import { useEffect, useMemo, useState } from "react";
import { useMotion } from "../../sant/motion/MotionProvider";
import { fetchEpisode, fetchFootage, fetchSet, type Fetch } from "./api";
import { FootageView } from "./FootageView";
import { useAsync, useClock } from "./hooks";
import { Pane, VerdictBadge } from "./Pane";
import { clockDuration, demoName, rejectedText, repairText, viewsOf, whatChanged, type DemoRow, type ShowcaseSet, type View } from "./model";

const VARIANTS_SHOWN = 6;

function DemoList({ set, active, onPick }: { set: ShowcaseSet; active: string; onPick: (id: string) => void }) {
  return (
    <ol className="data-demos" aria-label="Demos">
      {set.demos.map((d) => {
        const ok = d.variants.filter((v) => v.success).length;
        return (
          <li key={d.id}>
            <button type="button" className="data-demo" aria-pressed={d.id === active} onClick={() => onPick(d.id)}>
              <span className="data-demo__name">{demoName(d.id)}</span>
              <span className="data-demo__chips">
                {d.replay && <span className={`data-chip ${d.replay.success ? "is-pass" : "is-fail"}`}>Replay {d.replay.success ? "✓" : "✕"}</span>}
                {d.repair && <span className={`data-chip ${d.repair.status === "perfected" ? "is-pass" : "is-fail"}`}>{d.repair.status === "perfected" ? "Repaired" : "Discarded"}</span>}
                {d.variants.length > 0 && (
                  <span className="data-chip">
                    {ok}/{d.variants.length} variants
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function WhatChanged({ demo }: { demo: DemoRow }) {
  const r = demo.repair;
  if (!r) return null;
  const rows = whatChanged(r);
  return (
    <section className="holo-panel data-changed" aria-labelledby="data-changed-title">
      <h3 id="data-changed-title" className="data-h3">
        What SANT changed
      </h3>
      {demo.replay && !demo.replay.success && <p className="data-note">Physics rejected the human's take: {rejectedText(demo.replay.reasons)}.</p>}
      {r.issues.length > 0 && (
        <ul className="data-list" aria-label="What the check found">
          {r.issues.map((i, k) => (
            <li key={k}>
              <strong>{i.type.replace(/_/g, " ")}</strong>: {i.evidence}
            </li>
          ))}
        </ul>
      )}
      {r.status === "perfected" ? (
        <>
          <ul className="data-list" aria-label="Repairs">
            {r.repairs.map((x, k) => (
              <li key={k}>{repairText(x)}</li>
            ))}
          </ul>
          {rows.length > 0 && (
            <table className="data-table">
              <caption className="sant-sr-only">Before and after the repair</caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Human's take</th>
                  <th scope="col">Repaired</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.before}</td>
                    <td>{row.after}</td>
                    <td>{row.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="data-note">No repair passed physics, so SANT left this demo out of the data.</p>
      )}
    </section>
  );
}

function VariantCard({ name, view, t, onShow, fetchImpl }: { name: string; view: View; t: number; onShow: () => void; fetchImpl?: Fetch }) {
  const footage = useAsync(`${name}:${view.id}`, () => fetchFootage(name, view, "front", fetchImpl));
  return (
    <li className="holo-panel data-variant" data-holo-state={view.verdict ? (view.verdict.pass ? "pass" : "fail") : undefined}>
      <button type="button" onClick={onShow} aria-label={`Show ${view.label} in the right view`}>
        <FootageView footage={footage.state === "ok" ? footage.value : null} t={t} label={`Isaac Sim front camera, ${view.label}`} />
        <span className="data-variant__name">{view.label}</span>
      </button>
      <VerdictBadge verdict={view.verdict} />
    </li>
  );
}

export function Showcase({ name, fetchImpl }: { name: string; fetchImpl?: Fetch }) {
  const set = useAsync(`set:${name}`, () => fetchSet(name, fetchImpl));
  const [demoId, setDemoId] = useState<string | null>(null);
  const demos = set.state === "ok" ? set.value.demos : [];
  const demo = demos.find((d) => d.id === demoId) ?? demos[0] ?? null;
  const views = useMemo(() => (demo ? viewsOf(demo) : []), [demo]);
  const [pick, setPick] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    // A new demo starts on its story: what the human did against what SANT made of it.
    setPick({ a: null, b: null });
    setShowAll(false);
  }, [demo?.id]);
  const fallbackA = views[0];
  const fallbackB = views.find((v) => v.kind === "repaired") ?? views.find((v) => v.kind === "replay") ?? views[views.length - 1];
  const a = views.find((v) => v.key === pick.a) ?? fallbackA;
  const b = views.find((v) => v.key === pick.b) ?? fallbackB;

  const epA = useAsync(a ? `${name}:${a.live}:${a.id}` : null, () => fetchEpisode(name, a!, fetchImpl));
  const epB = useAsync(b ? `${name}:${b.live}:${b.id}` : null, () => fetchEpisode(name, b!, fetchImpl));
  const ftA = useAsync(a ? `${name}:${a.live}:${a.id}` : null, () => fetchFootage(name, a!, "front", fetchImpl));
  const ftB = useAsync(b ? `${name}:${b.live}:${b.id}` : null, () => fetchFootage(name, b!, "front", fetchImpl));
  const durations = [epA, epB].flatMap((e) => (e.state === "ok" ? [e.value.nSteps / e.value.fps] : []));
  const duration = clockDuration(durations);
  const { reduced } = useMotion();
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);
  const [t, seek] = useClock(durations.length ? duration : 0, playing);

  if (set.state === "loading") return <p className="data-note">Loading the experiment…</p>;
  if (set.state === "error") return <p className="data-note data-note--error">The experiment didn't load: {set.message}</p>;
  if (!demo || !a || !b) return <p className="data-note">This experiment has no demos yet.</p>;
  const variants = views.filter((v) => v.kind === "variant");
  const attempts = demo.variants;
  const shown = showAll ? variants : variants.slice(0, VARIANTS_SHOWN);

  return (
    <div className="data-showcase">
      <aside className="data-showcase__list">
        <DemoList set={set.value} active={demo.id} onPick={setDemoId} />
      </aside>
      <div className="data-showcase__main">
        <h2 className="data-h2">{demoName(demo.id)}</h2>
        <div className="data-panes">
          <Pane side="left" views={views} view={a} onPick={(k) => setPick((p) => ({ ...p, a: k }))} episode={epA} footage={ftA} t={t} />
          <Pane side="right" views={views} view={b} onPick={(k) => setPick((p) => ({ ...p, b: k }))} episode={epB} footage={ftB} t={t} />
        </div>
        <div className="data-transport">
          <button type="button" className="data-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
            {playing ? "Pause" : "Play"}
          </button>
          <label className="data-transport__scrub">
            <span className="sant-sr-only">Time</span>
            <input type="range" min={0} max={duration} step={0.02} value={Math.min(t, duration)} onChange={(e) => seek(Number(e.target.value))} />
          </label>
          <span className="data-transport__time">{t.toFixed(1)} s</span>
        </div>
        <WhatChanged demo={demo} />
        {attempts.length > 0 && (
          <section className="data-variants" aria-labelledby="data-variants-title">
            <h3 id="data-variants-title" className="data-h3">
              Multiplied variants: {attempts.filter((v) => v.success).length} of {attempts.length} verified
            </h3>
            <ul className="data-variants__grid">
              {shown.map((v) => (
                <VariantCard key={v.key} name={name} view={v} t={t} onShow={() => setPick((p) => ({ ...p, b: v.key }))} fetchImpl={fetchImpl} />
              ))}
            </ul>
            {variants.length > VARIANTS_SHOWN && !showAll && (
              <button type="button" className="data-btn data-btn--quiet" onClick={() => setShowAll(true)}>
                Show all {variants.length}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
