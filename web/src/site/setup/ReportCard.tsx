import type { CSSProperties } from "react";
import { Badge } from "../../sant/components/Badge";
import { pct } from "./fmt";
import { CheckIcon, CloseIcon, WarnIcon } from "./icons";
import { designFlaw, reasons, verdictLabel } from "./report";
import { ReachMap } from "./ReachMap";
import "./report.css";
import type { Parts, ReportCard as Card } from "./types";

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const MINUS = "−";
const signedDeg = (d: number) => `${d < 0 ? MINUS : d > 0 ? "+" : ""}${Math.abs(d)}°`;

/** The robot report card (byor-api.md §6). Every number here comes from the card; its sources are listed at the end. */
export function ReportCard({ report, parts }: { report: Card; parts: Parts }) {
  const pp = report.pick_place;
  const ok = pp.successes.value;
  const n = pp.successes.of;
  const flaw = designFlaw(report, parts);
  const why = reasons(report);
  const verdict = report.verdict.value;
  const hits = report.joint_limit_hits.value;
  const recorded = typeof report.provenance.fixture === "string" ? (report.provenance.fixture as string) : null;
  const mount = report.roles.mount?.pos ?? [0, 0, 0];

  return (
    <article className="byor-card" aria-labelledby="byor-card-title">
      <header className="byor-card__head">
        <h2 id="byor-card-title" className="byor-card__title">
          Report card
        </h2>
        <Badge tone={verdict === "ready" ? "live" : "issue"}>{verdictLabel(verdict)}</Badge>
        <p className="byor-card__meta">
          <span>{report.task.text}</span>
          <span className="sant-num">
            seeds {report.task.seeds[0]}–{report.task.seeds[1]}
          </span>
          <span className="sant-num">base at {mount.map((v) => v.toFixed(2)).join(", ")} m</span>
        </p>
      </header>

      {flaw && (
        <section className="byor-flaw" aria-labelledby="byor-flaw-title">
          <WarnIcon className="byor-flaw__icon" width={20} height={20} />
          <div>
            <h3 id="byor-flaw-title" className="byor-flaw__title">
              Design flaw found
            </h3>
            <p className="byor-flaw__lead">
              <code>{flaw.joint}</code> turns only {signedDeg(flaw.lowerDeg)} to {signedDeg(flaw.upperDeg)}, the narrowest range on this arm.
            </p>
            <p className="byor-flaw__body">
              It is the {ordinal(flaw.index)} of {flaw.of} arm joints, counted from the base, and it sat at a limit in{" "}
              <strong className="sant-num">
                {flaw.scenes} of {flaw.n}
              </strong>{" "}
              scenes.
              {flaw.unreachable > 0 && (
                <>
                  {" "}
                  The arm couldn't follow the path in <strong className="sant-num">{flaw.unreachable}</strong> of {flaw.n}, and the tool reaches{" "}
                  {pct(flaw.reach)} of the workspace in every pose.
                </>
              )}{" "}
              Look at this joint first.
            </p>
            <p className="byor-flaw__rule">
              Rule: on a robot that isn't ready, the arm joint with the narrowest range among those at a limit in at least 20% of the scenes.
            </p>
          </div>
        </section>
      )}

      <div className="byor-card__grid">
        <section className="byor-block" aria-labelledby="byor-pp-title">
          <h3 id="byor-pp-title" className="byor-block__title">
            Pick and place
          </h3>
          <p className="byor-score">
            <span className="byor-score__num sant-num">
              {ok}
              <span className="byor-score__of">/{n}</span>
            </span>
            <span className="byor-score__label">scenes done</span>
          </p>
          <ol className="byor-strip" aria-label={`${ok} of ${n} scenes done`}>
            {report.scenes.rows.map((s, i) => (
              <li
                key={s.seed}
                className="byor-strip__cell"
                data-ok={s.success}
                style={{ "--i": i } as CSSProperties}
                title={`Seed ${s.seed}: ${s.success ? "done" : s.reasons.join(", ").replace(/_/g, " ")}`}
              >
                {s.success ? <CheckIcon width={12} height={12} /> : <CloseIcon width={12} height={12} />}
                <span className="sant-sr-only">
                  Seed {s.seed}: {s.success ? "done" : `failed, ${s.reasons.join(", ").replace(/_/g, " ")}`}
                </span>
              </li>
            ))}
          </ol>
          {pp.tracking_mean_mm.value !== null && (
            <p className="byor-block__note">
              The tool stayed <span className="sant-num">{pp.tracking_mean_mm.value.toFixed(1)} mm</span> from the path on average.
            </p>
          )}

          <h4 className="byor-block__sub">Why scenes failed</h4>
          {why.length === 0 ? (
            <p className="byor-block__note">No scene failed.</p>
          ) : (
            <ul className="byor-reasons">
              {why.map((r) => (
                <li key={r.code} className="byor-reason">
                  <span className="byor-reason__label">
                    {r.label} <code>{r.code}</code>
                  </span>
                  <span className="byor-reason__bar" aria-hidden="true">
                    <span style={{ width: `${(100 * r.count) / n}%` }} />
                  </span>
                  <span className="byor-reason__count sant-num">
                    {r.count}
                    <span className="sant-sr-only"> of {n} scenes</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="byor-block__note">One scene can fail for several reasons.</p>
        </section>

        <section className="byor-block" aria-labelledby="byor-reach-title">
          <h3 id="byor-reach-title" className="byor-block__title">
            Reach map
          </h3>
          <ReachMap report={report} />
        </section>
      </div>

      <section className="byor-block" aria-labelledby="byor-limits-title">
        <h3 id="byor-limits-title" className="byor-block__title">
          Joints at their limits
        </h3>
        {hits.length === 0 ? (
          <p className="byor-block__note">No arm joint reached a limit.</p>
        ) : (
          <table className="byor-table">
            <thead>
              <tr>
                <th scope="col">Joint</th>
                <th scope="col">Limit</th>
                <th scope="col">Scenes</th>
                <th scope="col">Steps</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.joint + h.limit} data-flaw={flaw?.joint === h.joint || undefined}>
                  <th scope="row">
                    <code>{h.joint}</code>
                  </th>
                  <td>
                    {h.limit}
                    {h.value !== undefined && <span className="sant-num"> ({signedDeg(Math.round((h.value * 180) / Math.PI))})</span>}
                  </td>
                  <td className="sant-num">{h.scenes}</td>
                  <td className="sant-num">{h.steps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <details className="byor-sources byor-card__sources">
        <summary>Where every number comes from</summary>
        <ul>
          {recorded && <li>{recorded}</li>}
          <li>Scenes done: {pp.successes.source}</li>
          <li>Failure reasons: {pp.failure_reasons.source}</li>
          <li>Tracking: {pp.tracking_mean_mm.source}</li>
          <li>Reach map: {report.reach_map.source}</li>
          <li>Joint limits: {report.joint_limit_hits.source}</li>
          <li>Verdict: {report.verdict.source}</li>
          <li>Scenes: {report.task.source}</li>
        </ul>
      </details>
    </article>
  );
}
