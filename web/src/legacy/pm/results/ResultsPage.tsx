import { GlassCard, Zones } from "../../components";
import { describeError, PmApiError, pmFetch } from "../../../pm/api";
import { fmtPct, Loading, PageTitle, useLoad, type Load } from "../common";
import sampleResults from "../../../pm/mocks/results.sample.json";
import { chartPoints, chartRuns, parseResults, type Rate, type Results } from "../../../pm/results/results";
import "../pm.css";

const W = 640;
const H = 320;
const PAD = 44;
const BOX = { width: W, height: H, pad: PAD };
const LINE_CLASS: Record<string, string> = { raw: "pm-line--muted", raw_multiply: "pm-line--text", ours: "pm-line--ours" };
const fmtRate = (v: Rate) => (v === null ? "pending" : fmtPct(v));

interface Shown {
  results: Results;
  why: string | null; // why the sample is shown instead of measured results
}

/** Measured results when the backend has a valid file, else the sample with the reason. */
function decide(load: Load<unknown>): Shown | null {
  const sample = (why: string): Shown => ({ results: parseResults(sampleResults), why });
  if (load.state === "loading") return null;
  if (load.state === "error") {
    const e = load.error;
    if (e instanceof PmApiError && (e.kind === "not_found" || e.kind === "route_missing"))
      return sample("No measured results yet, so this page shows the sample.");
    if (e instanceof PmApiError && e.kind === "invalid") return sample(`The backend rejected its results file: ${e.detail}`);
    return sample(`${describeError(e)} Showing the sample until then.`);
  }
  try {
    return { results: parseResults(load.data), why: null };
  } catch (e) {
    return sample(`Can't show the measured results: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Series end labels, pushed apart so they never overlap. Series with no measured point get none. */
function endLabels(results: Results) {
  const labels = results.series
    .map((s) => ({ key: s.key, label: s.label, y: chartPoints(s.success, BOX).filter((p) => p !== null).pop()?.y }))
    .filter((l): l is { key: string; label: string; y: number } => l.y !== undefined)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
  return labels;
}

function SuccessChart({ results }: { results: Results }) {
  const xs = chartPoints(results.demos.map(() => 0), BOX).map((p) => p!.x);
  const nothing = results.series.every((s) => s.success.every((v) => v === null));
  return (
    <figure className="pm-chart">
      <svg viewBox={`0 0 ${W + 170} ${H}`} role="img" aria-labelledby="pm-chart-title">
        <title id="pm-chart-title">Policy success against the number of human demos{results.sample ? ", sample data" : ""}</title>
        {results.sample && (
          <defs>
            <pattern id="pm-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="pm-hatch-stripe" x1="0" y1="0" x2="0" y2="14" />
            </pattern>
          </defs>
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => {
          const y = PAD + (1 - v) * (H - 2 * PAD);
          return (
            <g key={v}>
              <line className="pm-gridline" x1={PAD} x2={W - PAD} y1={y} y2={y} />
              <text className="pm-chart-label" x={PAD - 8} y={y + 4} textAnchor="end">
                {fmtPct(v)}
              </text>
            </g>
          );
        })}
        {results.sample && <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="url(#pm-hatch)" />}
        {nothing && (
          <text className="pm-chart-label pm-chart-label--strong" x={W / 2} y={H / 2} textAnchor="middle">
            No policy evaluated yet: every point is pending
          </text>
        )}
        {results.demos.map((n, i) => (
          <text key={n} className="pm-chart-label" x={xs[i]} y={H - PAD + 20} textAnchor="middle">
            {n}
          </text>
        ))}
        <text className="pm-chart-label" x={W / 2} y={H - 6} textAnchor="middle">
          Human demos
        </text>
        {results.series.map((s) => {
          const cls = `pm-line ${LINE_CLASS[s.key] ?? "pm-line--text"}`;
          const pts = chartPoints(s.success, BOX);
          return (
            <g key={s.key}>
              {chartRuns(pts).map((run, k) => (
                <polyline key={k} className={cls} points={run.map((p) => `${p.x},${p.y}`).join(" ")} />
              ))}
              {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={3} className={cls} />)}
            </g>
          );
        })}
        {endLabels(results).map((l) => (
          <text
            key={l.key}
            className={`pm-chart-label${l.key === "ours" ? " pm-chart-label--strong" : ""}`}
            x={W - PAD + 12}
            y={l.y + 4}
          >
            {l.label}
          </text>
        ))}
      </svg>
      <ul className="pm-list" aria-label="Values">
        {results.series.map((s) => (
          <li key={s.key} data-testid={`series-${s.key}`}>
            <span className="pm-list-time">{s.label}</span>
            <span className="pm-num">
              {s.success.every((v) => v === null)
                ? "pending"
                : s.success.map((v, i) => `${fmtRate(v)} at ${results.demos[i]}`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Ablation({ results }: { results: Results }) {
  if (results.ablation.bars.length === 0) return <p className="small">pending</p>;
  return (
    <ul className="pm-bars">
      {results.ablation.bars.map((b) => (
        <li key={b.key} className="pm-bar-row">
          <span>{b.label}</span>
          <span className={`pm-bar-track${b.success === null ? " pm-bar-track--pending" : ""}`} aria-hidden="true">
            {b.success !== null && (
              <span className={`pm-bar-fill${b.key === "ours" ? " pm-bar-fill--ours" : ""}`} style={{ width: fmtPct(b.success) }} />
            )}
          </span>
          <span className="pm-num" data-testid="ablation-value">
            {fmtRate(b.success)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Yield({ results }: { results: Results }) {
  const { ours, mimicgen } = results.multiply_yield;
  return (
    <div className="stack">
      <div className="pm-yield" aria-hidden="true">
        {mimicgen && <span className="pm-yield-band" style={{ left: fmtPct(mimicgen[0]), width: fmtPct(mimicgen[1] - mimicgen[0]) }} />}
        {ours !== null && <span className="pm-yield-ours" style={{ left: fmtPct(ours) }} />}
      </div>
      <p className="small pm-num">
        Ours: <span data-testid="yield-ours">{fmtRate(ours)}</span>
        {results.sample && ours !== null ? " (sample)" : ""}.
        {mimicgen && ` MimicGen, published: ${fmtPct(mimicgen[0])} to ${fmtPct(mimicgen[1])}.`}
      </p>
    </div>
  );
}

const fetchResults = () => pmFetch<unknown>("/results");

export default function ResultsPage() {
  const [load] = useLoad(fetchResults, "results");
  const shown = decide(load);
  const results = shown?.results;
  const tag = results?.sample ? " (sample)" : "";
  const ablationAt = results?.ablation.demos;

  return (
    <Zones
      hero={
        <>
          <PageTitle title="Results">
            Does perfecting webcam demos before multiplying them train a better policy than multiplying them raw?
          </PageTitle>
          {!shown && <Loading what="results" />}
          {results?.sample && (
            <div className="pm-sample-banner" role="note">
              <strong>SAMPLE DATA — experiments pending</strong>
              <span>
                Every number here is a placeholder from web/src/pm/mocks/results.sample.json, used to lay out the page.
                None of it is measured, except MimicGen's published yield.
              </span>
            </div>
          )}
          {shown?.why && (
            <p className="muted small pm-note" role="status">
              {shown.why}
            </p>
          )}
          {results && !results.sample && (
            <p className="muted small pm-note">
              Measured results from the backend (DATA_DIR/results/results.json). Pending means not measured yet.
            </p>
          )}
          {results && (
            <GlassCard as="section" className="stack">
              <h2>Policy success on 50 test positions{tag}</h2>
              <SuccessChart results={results} />
            </GlassCard>
          )}
        </>
      }
    >
      {results && (
        <>
          <GlassCard as="section" className="stack">
            <h2>What the AI adds{tag}</h2>
            <p className="muted small">
              Policy success{ablationAt != null ? ` at ${ablationAt} human demos` : ""}, by how the demos were repaired.
            </p>
            <Ablation results={results} />
          </GlassCard>
          <GlassCard as="section" className="stack">
            <h2>Multiplication yield{tag}</h2>
            <p className="muted small">Variants that pass the physics check, out of every attempt.</p>
            <Yield results={results} />
          </GlassCard>
        </>
      )}
    </Zones>
  );
}
