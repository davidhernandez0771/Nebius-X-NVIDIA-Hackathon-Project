import { GlassCard, Zones } from "../../components";
import { fmtPct, PageTitle } from "../common";
import sampleResults from "../mocks/results.sample.json";
import { chartPoints, parseResults, type Results } from "./results";
import "../pm.css";

const W = 640;
const H = 320;
const PAD = 44;
const LINE_CLASS: Record<string, string> = { raw: "pm-line--muted", raw_multiply: "pm-line--text", ours: "pm-line--ours" };

/** Series end labels, pushed apart so they never overlap. */
function endLabels(results: Results) {
  const labels = results.series
    .map((s) => ({ key: s.key, label: s.label, y: chartPoints(s.success, { width: W, height: H, pad: PAD }).slice(-1)[0].y }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
  return labels;
}

function SuccessChart({ results }: { results: Results }) {
  const box = { width: W, height: H, pad: PAD };
  const xs = chartPoints(results.demos.map(() => 0), box).map((p) => p.x);
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
        {results.demos.map((n, i) => (
          <text key={n} className="pm-chart-label" x={xs[i]} y={H - PAD + 20} textAnchor="middle">
            {n}
          </text>
        ))}
        <text className="pm-chart-label" x={W / 2} y={H - 6} textAnchor="middle">
          Human demos
        </text>
        {results.series.map((s) => {
          const pts = chartPoints(s.success, box);
          return (
            <g key={s.key}>
              <polyline className={`pm-line ${LINE_CLASS[s.key] ?? "pm-line--text"}`} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} className={`pm-line ${LINE_CLASS[s.key] ?? "pm-line--text"}`} />
              ))}
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
    </figure>
  );
}

function Ablation({ results }: { results: Results }) {
  return (
    <ul className="pm-bars">
      {results.ablation.bars.map((b) => (
        <li key={b.key} className="pm-bar-row">
          <span>{b.label}</span>
          <span className="pm-bar-track" aria-hidden="true">
            <span className={`pm-bar-fill${b.key === "ours" ? " pm-bar-fill--ours" : ""}`} style={{ width: fmtPct(b.success) }} />
          </span>
          <span className="pm-num">{fmtPct(b.success)}</span>
        </li>
      ))}
    </ul>
  );
}

function Yield({ results }: { results: Results }) {
  const [lo, hi] = results.multiply_yield.mimicgen;
  const ours = results.multiply_yield.ours;
  return (
    <div className="stack">
      <div className="pm-yield" role="img" aria-label={`Our yield ${fmtPct(ours)}; MimicGen published ${fmtPct(lo)} to ${fmtPct(hi)}`}>
        <span className="pm-yield-band" style={{ left: fmtPct(lo), width: fmtPct(hi - lo) }} />
        <span className="pm-yield-ours" style={{ left: fmtPct(ours) }} />
      </div>
      <p className="small pm-num">
        Ours: {fmtPct(ours)}{results.sample ? " (sample)" : ""}. MimicGen, published: {fmtPct(lo)} to {fmtPct(hi)}.
      </p>
    </div>
  );
}

export default function ResultsPage({ data = sampleResults as unknown }: { data?: unknown }) {
  let results: Results | null = null;
  let problem = "";
  try {
    results = parseResults(data);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const tag = results?.sample ? " (sample)" : "";

  return (
    <Zones
      hero={
        <>
          <PageTitle title="Results">
            Does perfecting webcam demos before multiplying them train a better policy than multiplying them raw?
          </PageTitle>
          {results?.sample && (
            <div className="pm-sample-banner" role="note">
              <strong>SAMPLE DATA — experiments pending</strong>
              <span>
                Every number on this page is a placeholder from web/src/pm/mocks/results.sample.json, used to lay out
                the page. None of it is measured, except MimicGen's published yield.
              </span>
            </div>
          )}
          {problem && (
            <GlassCard variant="provisional" className="empty-state">
              <h2>Can't show these results</h2>
              <p className="muted" role="alert">
                {problem}
              </p>
            </GlassCard>
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
            <p className="muted small">Policy success at {results.ablation.demos} human demos, by how the demos were repaired.</p>
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
