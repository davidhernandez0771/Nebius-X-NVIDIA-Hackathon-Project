// The failure analyst (/analysis): how a trained policy failed, what NVIDIA Nemotron says to change in the next
// round's data, and which of its claims the measurements kept or sent back. Code measures and checks; Nemotron
// proposes. The data is the big test's committed eval results (app/routers/analysis.py). Reading never calls the
// model; "Ask Nemotron now" does, when the server allows it. ?source=<id> is the URL state.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAsync } from "../data/hooks";
import { HoloPage, HoloPanel, HoloRule, HoloTag } from "../holo/Holo";
import { fetchAnalysis, fetchSources, runAnalysis, type Fetch } from "./api";
import {
  attemptState,
  axisLabel,
  extent,
  OUTCOMES,
  outcomeOf,
  pct,
  pText,
  verdictText,
  type Analysis,
  type Range,
  type Recipe,
  type Support,
} from "./model";
import { SceneMap, type MapRegion } from "./SceneMap";
import "./analysis.css";

const DEFAULT_SOURCE = "bigtest_final";

function union(a: Range | null, b: Range | null, pad = 0.03): Range {
  const lo = Math.min(a?.[0] ?? 0.4, b?.[0] ?? 0.4);
  const hi = Math.max(a?.[1] ?? 0.6, b?.[1] ?? 0.6);
  return [lo - pad, hi + pad];
}

function regionsFor(recipe: Recipe | null | undefined, which: "cube" | "bin", kind: "nemotron" | "rules"): MapRegion[] {
  return (recipe?.regions ?? []).map((g) => ({
    name: g.name,
    kind,
    label: kind === "nemotron" ? `Nemotron · ${g.name.replace(/_/g, " ")}` : "rules baseline",
    x: which === "cube" ? g.cube_x : g.bin_x,
    y: which === "cube" ? g.cube_y : g.bin_y,
  }));
}

function SupportRows({ who, support }: { who: string; support: Support[] }) {
  return (
    <>
      {support.map((s) => (
        <tr key={`${who}-${s.region}`}>
          <th scope="row">{who}</th>
          <td>{s.region.replace(/_/g, " ")}</td>
          <td className="an-num">{s.episodes_inside}</td>
          <td className="an-num">
            {s.target_failures_inside} / {s.target_failures_total}
          </td>
          <td className="an-num">
            {pct(s.rate_inside)} vs {pct(s.rate_overall)}
          </td>
          <td className="an-num">{pText(s.p_value)}</td>
        </tr>
      ))}
    </>
  );
}

function Report({ a, onRun, running, runError }: { a: Analysis; onRun: () => void; running: boolean; runError: string | null }) {
  const n = a.nemotron;
  const x = union(extent(a.failure_table, "cube_x"), extent(a.failure_table, "bin_x"));
  const y = union(extent(a.failure_table, "cube_y"), extent(a.failure_table, "bin_y"));
  const showRules = (a.rules?.recipe.regions.length ?? 0) > 0;
  const seen = OUTCOMES.filter((o) => a.points.some((p) => outcomeOf(p) === o.id));
  const rejected = n?.attempts.filter((t) => attemptState(t) === "sent back").length ?? 0;

  return (
    <>
      {(a.post_hoc || a.untraced) && (
        <HoloPanel className="an-notes" state="fail" aria-label="How to read this">
          {a.post_hoc && (
            <p>
              <strong>Post-hoc.</strong> These episodes include a pre-registered test that has already run. Its result
              stands as run. Anything suggested here has to be judged on fresh seeds.
            </p>
          )}
          {a.untraced && (
            <p>
              <strong>No step traces.</strong> The traces are on the GPU machine, so each episode comes from its result
              row: the scene, the eval's reason codes, and where the cube ended. Scene patterns can be checked; grasp
              and carry measurements can't.
            </p>
          )}
        </HoloPanel>
      )}

      <div className="an-tiles">
        <HoloPanel className="an-tile">
          <HoloTag>Episodes</HoloTag>
          <span className="an-tile__big">
            {a.successes}/{a.episodes}
          </span>
          <span className="an-tile__sub">succeeded · {pct(a.successes / Math.max(1, a.episodes))}</span>
        </HoloPanel>
        <HoloPanel className="an-tile">
          <HoloTag>First failures</HoloTag>
          <ul className="an-tile__list">
            {Object.entries(a.failure_counts).map(([k, v]) => (
              <li key={k}>
                <span>{k.replace(/_/g, " ")}</span>
                <span className="an-num">{v}</span>
              </li>
            ))}
            {!Object.keys(a.failure_counts).length && <li>none</li>}
          </ul>
        </HoloPanel>
        <HoloPanel className="an-tile an-tile--verdict" state={n?.recipe ? "pass" : undefined}>
          <HoloTag dot>Nemotron's verdict</HoloTag>
          <span className="an-tile__verdict">{verdictText(n)}</span>
          {n && (
            <span className="an-tile__sub">
              {n.candidates} of {n.k} samples passed · {rejected} claims sent back · {n.calls} calls · $
              {n.cost_usd.toFixed(3)}
              {n.agreement !== null && ` · agreement ${n.agreement.toFixed(2)}`}
            </span>
          )}
          {n?.model && <span className="an-tile__model">{n.model}</span>}
        </HoloPanel>
      </div>

      {a.live_enabled && (
        <div className="an-live">
          <button type="button" className="an-btn" onClick={onRun} disabled={running}>
            {running ? "Asking Nemotron…" : "Ask Nemotron now"}
          </button>
          <span className="an-live__note">3 independent samples, each checked by code; about $0.05 and a minute or two.</span>
          {runError && (
            <span className="an-live__error" role="alert">
              {runError}
            </span>
          )}
        </div>
      )}

      <HoloRule label="Where the failures were" />
      <div className="an-maps">
        <SceneMap title="Where the cube started" which="cube" points={a.points} x={x} y={y} regions={[...(showRules ? regionsFor(a.rules?.recipe, "cube", "rules") : []), ...regionsFor(n?.recipe, "cube", "nemotron")]} />
        <SceneMap title="Where the bin was" which="bin" points={a.points} x={x} y={y} regions={[...(showRules ? regionsFor(a.rules?.recipe, "bin", "rules") : []), ...regionsFor(n?.recipe, "bin", "nemotron")]} />
        <ul className="an-legend" aria-label="Legend">
          {seen.map((o) => (
            <li key={o.id} className={`an-legend__item an-mark--${o.id}`}>
              <svg viewBox="0 0 14 14" aria-hidden="true">
                {o.shape === "circle" && <circle cx={7} cy={7} r={5} />}
                {o.shape === "triangle" && <path d="M7,1 L13,12 L1,12 Z" />}
                {o.shape === "square" && <rect x={2} y={2} width={10} height={10} rx={1} />}
                {o.shape === "diamond" && <path d="M7,1 L13,7 L7,13 L1,7 Z" />}
              </svg>
              {o.label} · {a.points.filter((p) => outcomeOf(p) === o.id).length}
            </li>
          ))}
          {n?.recipe?.regions.length ? <li className="an-legend__item an-legend__region">Nemotron's region</li> : null}
          {showRules ? <li className="an-legend__item an-legend__region an-legend__region--rules">rules baseline</li> : null}
        </ul>
      </div>

      <HoloRule label="What Nemotron claimed, and what the code checked" />
      {n ? (
        <div className="an-scroll">
          <table className="an-table an-claims">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Nemotron claimed</th>
                <th scope="col">Check</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {n.attempts.map((t, i) => {
                const state = attemptState(t);
                const attempt = n.attempts.slice(0, i + 1).filter((u) => u.sample === t.sample).length;
                return (
                  <tr key={i} data-state={state}>
                    <td className="an-num">
                      {t.sample + 1}
                      {attempt > 1 && <span className="an-try">try {attempt}</span>}
                    </td>
                    <td>
                      {t.claimed ? (
                        <>
                          <span className="an-claim">{t.claimed.summary}</span>
                          {(t.claimed.regions.length > 0 || t.claimed.fixes.length > 0) && (
                            <span className="an-claim__what">
                              {[...t.claimed.regions.map((r) => `region: ${r.replace(/_/g, " ")}`), ...t.claimed.fixes.map((f) => `fix: ${f.replace(/_/g, " ")}`)].join(" · ")}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="an-claim__none">{state === "no answer" ? "no reply" : "no usable JSON"}</span>
                      )}
                    </td>
                    <td>
                      <span className={`an-pill an-pill--${state.replace(" ", "-")}`}>{state}</span>
                    </td>
                    <td className="an-why">{t.errors.length ? t.errors.join(" ") : "Every claim matched the measurements."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="an-empty">Nemotron hasn't analysed this source yet.{a.live_enabled ? " Ask it now above." : " Run scripts/analyze_failures.py, or allow live runs on the server (SANT_ANALYST_LIVE=1)."}</p>
      )}

      {(n?.support?.length || a.rules?.support.length) ? (
        <>
          <HoloRule label="Region support, measured" />
          <div className="an-scroll">
            <table className="an-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">Region</th>
                  <th scope="col">Episodes inside</th>
                  <th scope="col">Its failures inside</th>
                  <th scope="col">Rate inside vs all</th>
                  <th scope="col">One-sided Fisher</th>
                </tr>
              </thead>
              <tbody>
                {n?.support && <SupportRows who="Nemotron" support={n.support} />}
                {a.rules && <SupportRows who="Rules baseline" support={a.rules.support} />}
              </tbody>
            </table>
          </div>
          <p className="an-foot">
            A region is kept only if it holds at least 3 of its failures at a clearly higher rate than outside it (p ≤
            0.1). The rules baseline boxes every scene where the commonest failure happened.
          </p>
        </>
      ) : null}

      <details className="an-details">
        <summary>All {a.episodes} episodes as a table</summary>
        <div className="an-scroll">
          <table className="an-table">
            <thead>
              <tr>
                <th scope="col">Seed</th>
                <th scope="col">Set</th>
                <th scope="col">Outcome</th>
                <th scope="col">Cube x, y (m)</th>
                <th scope="col">Bin x, y (m)</th>
                <th scope="col">Reasons</th>
              </tr>
            </thead>
            <tbody>
              {a.points.map((p) => (
                <tr key={p.seed}>
                  <td className="an-num">{p.seed}</td>
                  <td>{p.test ? "test" : "selection"}</td>
                  <td>{OUTCOMES.find((o) => o.id === outcomeOf(p))!.label}</td>
                  <td className="an-num">
                    {p.cube[0].toFixed(2)}, {p.cube[1].toFixed(2)}
                  </td>
                  <td className="an-num">
                    {p.bin[0].toFixed(2)}, {p.bin[1].toFixed(2)}
                  </td>
                  <td>{p.reasons.join(", ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="an-foot">Per-axis first-failure counts: {a.failure_table.filter((r) => Object.keys(r.failures).length).map((r) => `${axisLabel[r.axis] ?? r.axis} ${r.bin[0]}–${r.bin[1]}: ${Object.values(r.failures).reduce((s, v) => s + v, 0)}/${r.n}`).join(" · ")}</p>
      </details>
    </>
  );
}

export default function AnalysisPage({ fetchImpl = fetch }: { fetchImpl?: Fetch }) {
  const [params, setParams] = useSearchParams();
  const source = params.get("source") ?? DEFAULT_SOURCE;
  const sources = useAsync("sources", () => fetchSources(fetchImpl));
  const [runs, setRuns] = useState(0);
  const [override, setOverride] = useState<Analysis | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const loaded = useAsync(`${source}:${runs}`, () => fetchAnalysis(source, fetchImpl));
  const analysis = override?.id === source ? override : loaded.state === "ok" ? loaded.value : null;

  const pick = (id: string) => {
    setOverride(null);
    setRunError(null);
    setParams({ source: id });
  };

  const run = () => {
    setRunning(true);
    setRunError(null);
    runAnalysis(source, fetchImpl).then(
      (a) => {
        setOverride(a);
        setRunning(false);
      },
      (e: unknown) => {
        setRunError(e instanceof Error ? e.message : String(e));
        setRunning(false);
        setRuns((r) => r + 1);
      },
    );
  };

  return (
    <HoloPage title="Failure analyst" here="analysis">
      <div className="an">
        <p className="an-lede">
          After a policy is trained and tested, NVIDIA Nemotron reads how its episodes failed and proposes what training
          data to make next: more scenes where it fails, or a change to the demos. Code measures every episode and
          checks every claim against the numbers. A claim the numbers don't support goes back to Nemotron with them.
        </p>

        <nav className="an-sources" aria-label="Which model's episodes">
          {sources.state === "ok" &&
            sources.value.sources.map((s) => (
              <button key={s.id} type="button" className="an-source" aria-pressed={s.id === source} onClick={() => pick(s.id)}>
                <span className="an-source__title">{s.title}</span>
                <span className="an-source__sub">
                  {s.successes}/{s.episodes} succeeded{s.cached ? " · analysed" : ""}
                </span>
              </button>
            ))}
          {sources.state === "error" && <p className="an-error">Couldn't list the analyses: {sources.message}. Is the API running?</p>}
        </nav>

        {analysis ? (
          <>
            <p className="an-detail">{analysis.detail}</p>
            <Report a={analysis} onRun={run} running={running} runError={runError} />
          </>
        ) : loaded.state === "error" ? (
          <p className="an-error" role="alert">
            Couldn't load this analysis: {loaded.message}
          </p>
        ) : (
          <p className="an-empty">Loading the episodes…</p>
        )}
      </div>
    </HoloPage>
  );
}
