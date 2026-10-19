// The demo strip: one demo's timeline in three lanes, read top to bottom as
// the pipeline's rule. What the model claims (issues), what happened (the
// demo's phases), and what code does about it (repairs).

import { StatusPill } from "../../components";
import type { StoredDiagnosis } from "../../../pm/types";
import { layoutTimeline, type Span } from "../../../pm/review/timeline";

const at = (s: Span) => ({ left: `${s.left}%`, width: `${s.width}%` });

function timeText(item: { t?: number | null; t0?: number | null; t1?: number | null }): string {
  if (item.t0 != null && item.t1 != null) return `${item.t0.toFixed(1)}–${item.t1.toFixed(1)} s`;
  if (item.t != null) return `at ${item.t.toFixed(1)} s`;
  return "whole demo";
}

const DECISION_TONE = { keep: "accent", repair: "warm", discard: "danger" } as const;

export default function DemoStrip({ duration, stored }: { duration: number; stored: StoredDiagnosis }) {
  const { diagnosis, gated } = stored;
  const layout = layoutTimeline(duration, diagnosis);
  const point = (s: Span) => (s.width === 0 ? " pm-mark--point" : "");

  return (
    <div className="stack">
      <div className="row wrap">
        <StatusPill tone={DECISION_TONE[diagnosis.decision]}>Decision: {diagnosis.decision}</StatusPill>
        <StatusPill>
          Diagnosed by {stored.source === "nemotron" ? (stored.model_id ?? "Nemotron") : "the rules detector"}
        </StatusPill>
      </div>

      <div className="pm-strip" role="group" aria-label={`Timeline of a ${duration.toFixed(1)} second demo`}>
        <span className="pm-lane-label">The model saw</span>
        <div className="pm-lane">
          {layout.issues.map((i, k) => (
            <span
              key={k}
              className={`pm-mark pm-mark--issue${point(i)}`}
              style={at(i)}
              title={`${i.type}: ${i.evidence}`}
            />
          ))}
        </div>

        <span className="pm-lane-label">Phases</span>
        <div className="pm-lane pm-lane--phases">
          {layout.segments.map((s, k) => (
            <span key={k} className="pm-seg" style={at(s)} title={s.name}>
              {s.name}
            </span>
          ))}
        </div>

        <span className="pm-lane-label">Code repairs</span>
        <div className="pm-lane">
          {layout.repairs.map((r, k) => (
            <span key={k} className={`pm-mark pm-mark--repair${point(r)}`} style={at(r)} title={r.op} />
          ))}
        </div>

        <div className="pm-axis pm-num" aria-hidden="true">
          <span>0 s</span>
          <span>{(duration / 2).toFixed(1)} s</span>
          <span>{duration.toFixed(1)} s</span>
        </div>
      </div>

      <div className="pm-two">
        <section className="stack">
          <h3>Issues</h3>
          {diagnosis.issues.length === 0 && <p className="muted small">None.</p>}
          <ul className="pm-list">
            {diagnosis.issues.map((i, k) => (
              <li key={k}>
                <span className="pm-list-time">{timeText(i)}</span>
                <span>
                  <strong>{i.type}</strong> <span className="muted">{i.evidence}</span>
                </span>
              </li>
            ))}
            {gated.map((g, k) => (
              <li key={`g${k}`} title="Dropped because the measured metrics contradict it">
                <span className="pm-list-time">gated</span>
                <span className="pm-gated">{g}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="stack">
          <h3>Repairs</h3>
          {diagnosis.repairs.length === 0 && <p className="muted small">None.</p>}
          <ul className="pm-list">
            {diagnosis.repairs.map((r, k) => (
              <li key={k}>
                <span className="pm-list-time">{timeText(r)}</span>
                <strong>{r.op}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
