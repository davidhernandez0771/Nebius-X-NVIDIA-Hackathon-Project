import type { CSSProperties, ReactNode } from "react";
import { Badge } from "../../sant/components/Badge";
import { Card } from "../../sant/components/Card";
import { formatStat } from "../../sant/motion/format";
import { Cite } from "./Cite";
import type { ReportCard as Data, Source } from "./facts";

const TONE = { live: "live", issue: "issue", neutral: "plain" } as const;

type Measure = NonNullable<Data["copies"]>;

function Pending({ why }: { why?: string }) {
  return (
    <>
      <span className="sant-report__pending">Pending</span>
      {why && <span className="sant-report__aside">{why}</span>}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sant-report__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Count({ m }: { m: Measure }) {
  return (
    <>
      <span className="sant-report__big sant-num">
        {m.k}/{m.n} <span className="sant-report__pct">{formatStat((100 * m.k) / m.n, 1)}%</span>
      </span>
      <span className="sant-report__what">
        {m.what}
        {m.ci && (
          <>
            , 95% CI <span className="sant-num">{m.ci}</span>
          </>
        )}
      </span>
      {m.also && <span className="sant-report__aside">{m.also}</span>}
    </>
  );
}

/**
 * The robot report card: copies that pass physics, how often the trained policy succeeds, why it
 * fails, and how far it reaches. A template fed by props, so the robot shelf can show the same
 * card. Anything not measured says "Pending", with the reason when there is one.
 */
export function ReportCard({ card }: { card: Data }) {
  const { copies, policy, failures, reach, pendingNotes = {} } = card;
  const sources = [copies?.source, copies?.alsoSource, policy?.source, failures?.source, reach?.source].filter((s): s is Source => !!s);
  const pending = sources.length === 0;

  return (
    <Card
      title={card.robot}
      tone={TONE[card.status.tone]}
      aside={<Badge tone={card.status.tone}>{card.status.label}</Badge>}
      className={`sant-report${pending ? " sant-report--pending" : ""}`}
    >
      <p className="sant-report__summary">{card.summary}</p>
      <dl className="sant-report__rows">
        <Row label="Copies verified">{copies ? <Count m={copies} /> : <Pending />}</Row>
        <Row label="Policy success">{policy ? <Count m={policy} /> : <Pending why={pendingNotes.policy} />}</Row>
        <Row label="Why it fails">
          {failures ? (
            <>
              <span className="sant-report__what">{failures.why}</span>
              {failures.counts && (
                <ul className="sant-report__reasons">
                  {failures.counts.map((c) => (
                    <li key={c.label}>
                      <span className="sant-report__reason">{c.label}</span>
                      <span className="sant-report__count sant-num">
                        {c.k} of {c.of} failures
                      </span>
                      <span className="sant-report__track" aria-hidden="true">
                        <span className="sant-report__fill" style={{ "--f": String(c.k / c.of) } as CSSProperties} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <Pending />
          )}
        </Row>
        <Row label="Reach">
          {reach ? (
            <>
              <span className="sant-report__big">{reach.value}</span>
              <span className="sant-report__what">{reach.detail}</span>
            </>
          ) : (
            <Pending why={pendingNotes.reach} />
          )}
        </Row>
      </dl>
      {!pending && (
        <p className="sant-report__sources">
          {sources.map((s, i) => (
            <Cite key={i} source={s} prefix={i === 0 ? "Sources: " : ""} />
          ))}
        </p>
      )}
    </Card>
  );
}
