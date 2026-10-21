import { Badge } from "../../sant/components/Badge";
import { SectionHeader } from "../../sant/components/SectionHeader";
import { Cite } from "./Cite";
import { formatP, formatPct, type Arm, type Experiment, type Group } from "./data";

const count = (a: Arm) => (a.k === null ? null : `${a.k}/${a.n}`);

function Ledger({ group }: { group: Group }) {
  const byKey = new Map(group.arms.map((a) => [a.key, a]));
  const side = (key: string) => count(byKey.get(key)!) ?? byKey.get(key)!.label;
  return (
    <table className="sant-results__ledger" aria-label={group.label}>
      <caption className="sant-results__caption">{group.label}</caption>
      <thead>
        <tr>
          <th scope="col">Arm</th>
          <th scope="col">Successes</th>
          <th scope="col">Rate</th>
          <th scope="col">95% CI</th>
        </tr>
      </thead>
      <tbody>
        {group.arms.map((a) => (
          <tr key={a.key} data-arm={a.k === null ? "pending" : a.highlight ? "ours" : "base"} data-testid={`arm-${a.key}`}>
            <th scope="row">
              {a.label}
              {a.detail && <span className="sant-results__detail">{a.detail}</span>}
            </th>
            {a.k === null ? (
              <td colSpan={3} className="sant-results__pending">
                Pending
              </td>
            ) : (
              <>
                <td className="sant-num">{count(a)}</td>
                <td className="sant-num">{formatPct(a.k / a.n)}</td>
                <td className="sant-num">{a.ci ? `${formatPct(a.ci[0]).slice(0, -1)}–${formatPct(a.ci[1])}` : "—"}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
      {group.comparisons.length > 0 && (
        <tfoot>
          {group.comparisons.map((c) => (
            <tr key={`${c.a}-${c.b}`}>
              <td colSpan={4} data-testid="comparison">
                {side(c.a)} vs {side(c.b)}:{" "}
                {c.p === null ? (
                  "pending"
                ) : (
                  <>
                    p = <span className="sant-num">{formatP(c.p)}</span>
                    {c.verdict && `, ${c.verdict}`}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tfoot>
      )}
    </table>
  );
}

/** One experiment from results.json: its arms and tests, then its seeds, test, limits and sources in the margin. */
export function ExperimentSection({ e }: { e: Experiment }) {
  const id = `results-${e.id}`;
  return (
    <section className={`sant-results__section${e.pending ? " sant-results__section--pending" : ""}`} aria-labelledby={id}>
      <SectionHeader id={id} title={e.title} lede={e.question} />
      <div className="sant-notes">
        <div className="sant-results__proof">
          {e.pending && (
            <p className="sant-results__so-far">
              <Badge tone="info">Pending</Badge> {e.pending}
            </p>
          )}
          {e.groups.map((g) => (
            <Ledger key={g.label} group={g} />
          ))}
          {e.finding && <p className="sant-results__finding">{e.finding}</p>}
        </div>
        <aside className="sant-margin-note">
          <dl className="sant-results__facts">
            <dt>Seeds</dt>
            <dd>{e.seeds}</dd>
            <dt>Test</dt>
            <dd>{e.test}</dd>
            {e.setup && (
              <>
                <dt>Setup</dt>
                <dd>{e.setup}</dd>
              </>
            )}
            {e.caveats.length > 0 && (
              <>
                <dt>Limits</dt>
                <dd>
                  <ul>
                    {e.caveats.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
          {e.sources.map((s, i) => (
            <Cite key={i} source={s} prefix={i === 0 ? "Sources: " : ""} />
          ))}
        </aside>
      </div>
    </section>
  );
}
