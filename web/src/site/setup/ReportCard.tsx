import type { CSSProperties } from "react";
import { Badge } from "../../sant/components/Badge";
import { pct } from "./fmt";
import { CheckIcon, CloseIcon, WarnIcon } from "./icons";
import { designFlaw, limitsByJoint, reasons, verdictLabel } from "./report";
import { ReachMap } from "./ReachMap";
import "./report.css";
import type { Parts, ReportCard as Card } from "./types";

const MINUS = "−";
const signedDeg = (d: number) => `${d < 0 ? MINUS : d > 0 ? "+" : ""}${Math.abs(d)}°`;
/** Joint rows shown on the card; the full list is in Settings. */
const LIMIT_ROWS = 5;

/**
 * The robot report card (byor-api.md §6) on one screen: pick and place, the reach map, and what limits the arm.
 * Every number comes from the card; Settings lists the sources.
 */
export function ReportCard({ report, parts, onSources }: { report: Card; parts: Parts; onSources?: () => void }) {
  const pp = report.pick_place;
  const ok = pp.successes.value;
  const n = pp.successes.of;
  const flaw = designFlaw(report, parts);
  const why = reasons(report);
  const verdict = report.verdict.value;
  const mount = report.roles.mount?.pos ?? [0, 0, 0];
  const limits = limitsByJoint(report);
  const shown = [...limits.filter((l) => l.joint === flaw?.joint), ...limits.filter((l) => l.joint !== flaw?.joint)].slice(0, LIMIT_ROWS);
  const range = (joint: string) => parts.joints.find((j) => j.name === joint)?.limits;

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
          {onSources && (
            <button type="button" className="byor-link" onClick={onSources}>
              Sources
            </button>
          )}
        </p>
      </header>

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
                {s.success ? <CheckIcon width={11} height={11} /> : <CloseIcon width={11} height={11} />}
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
          {why.length > 1 && <p className="byor-block__note">One scene can fail for several reasons.</p>}
        </section>

        <section className="byor-block" aria-labelledby="byor-reach-title">
          <h3 id="byor-reach-title" className="byor-block__title">
            Reach map
          </h3>
          <ReachMap report={report} />
        </section>

        <div className="byor-card__side">
          {flaw ? (
            <section className="byor-flaw" aria-labelledby="byor-flaw-title">
              <h3 id="byor-flaw-title" className="byor-flaw__title">
                <WarnIcon className="byor-flaw__icon" />
                Design flaw found
              </h3>
              <p className="byor-flaw__lead">
                <code>{flaw.joint}</code> turns only {signedDeg(flaw.lowerDeg)} to {signedDeg(flaw.upperDeg)}, the narrowest range on this arm.
              </p>
              <p className="byor-flaw__body">
                Joint {flaw.index} of {flaw.of} from the base. It sat at a limit in{" "}
                <strong className="sant-num">
                  {flaw.scenes} of {flaw.n}
                </strong>{" "}
                scenes
                {flaw.unreachable > 0 ? (
                  <>
                    ; the arm couldn't follow the path in <strong className="sant-num">{flaw.unreachable}</strong> of {flaw.n}, and the tool reaches{" "}
                    {pct(flaw.reach)} of the workspace in every pose.
                  </>
                ) : (
                  "."
                )}{" "}
                Look at this joint first.
              </p>
            </section>
          ) : (
            verdict === "ready" && (
              <p className="byor-noflaw">
                <CheckIcon /> No design flaw found: {ok} of {n} scenes, reach {pct(report.reach_map.fraction.value)} in every pose.
              </p>
            )
          )}

          <section className="byor-block" aria-labelledby="byor-limits-title">
            <h3 id="byor-limits-title" className="byor-block__title">
              Joints at their limits
            </h3>
            {limits.length === 0 ? (
              <p className="byor-block__note">No arm joint reached a limit.</p>
            ) : (
              <>
                <table className="byor-table">
                  <thead>
                    <tr>
                      <th scope="col">Joint</th>
                      <th scope="col">Range</th>
                      <th scope="col">At</th>
                      <th scope="col">Scenes</th>
                      <th scope="col">Steps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => {
                      const r = range(l.joint);
                      return (
                        <tr key={l.joint} data-flaw={flaw?.joint === l.joint || undefined}>
                          <th scope="row">
                            <code>{l.joint}</code>
                          </th>
                          <td className="sant-num">
                            {r ? `${signedDeg(Math.round((r.lower * 180) / Math.PI))} to ${signedDeg(Math.round((r.upper * 180) / Math.PI))}` : "–"}
                          </td>
                          <td className="byor-table__sides">{l.sides.length === 2 ? "both" : l.sides[0]}</td>
                          <td className="sant-num">{l.scenes}</td>
                          <td className="sant-num">{l.steps}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {limits.length > shown.length && (
                  <p className="byor-block__note">
                    {limits.length - shown.length} more {limits.length - shown.length === 1 ? "joint" : "joints"} in{" "}
                    {onSources ? (
                      <button type="button" className="byor-link" onClick={onSources}>
                        Settings
                      </button>
                    ) : (
                      "Settings"
                    )}
                    .
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
