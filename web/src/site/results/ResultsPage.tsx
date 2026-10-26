// The Results page (Field Notes): the headline result with its CIs and limits, the 0 → 100 →
// 300 copies chart replayed scene by scene, the other measured experiments, the robot report card,
// and what is still pending. Every number comes from ./results.json (via ./data.ts and ./facts.ts), or, in the proof
// band of pre-registered results (./ProofSection.tsx), from ./proofData.ts, and sits next to its note and line. Spec: docs/design/content-spec.md §4.
import { ChartFrame } from "../../sant/components/ChartFrame";
import { CountUpTiles } from "../../sant/components/CountUpTiles";
import { SectionHeader } from "../../sant/components/SectionHeader";
import { formatStat } from "../../sant/motion/format";
import { StoryShell } from "../../sant/shells/StoryShell";
import { Cite } from "./Cite";
import { CopiesChart } from "./CopiesChart";
import { RESULTS, experiment } from "./data";
import { ExperimentSection } from "./ExperimentSection";
import { ProofCite, ProofSection } from "./ProofSection";
import { LEAD, PROOF_NOTES } from "./proofData";
import { ARMS, COMPARISONS, HEADLINE, LIMITS, NOTES, PLATEAU, PROOF_SO_FAR, REPORT_CARDS, SCENES, VERIFIED, cite } from "./facts";
import { ReportCard } from "./ReportCard";
import "./results.css";

const [RAW, X100] = ARMS;

/** The real demos, from stores.json (scripts/build_site_results.py, read from the experiment stores). */
const REAL = ["webcam", "repair_ab", "mouse"].map(experiment);
/** results.json experiments the bespoke sections above don’t already show, measured or pending. */
const MORE = ["grasp_fix", "nemotron"].map(experiment);
const PENDING = RESULTS.experiments.filter((e) => e.pending);

const LINKS = [{ to: "/site/results", label: "Results" }];
const CTA = { label: "Try it", to: "/pm/record" };

/**
 * What the page leads with (site-nav, 2026-10-26): the newest pre-registered one-shot result, from ./proofData.ts
 * (LEAD). The home page's "See the result" links here (#proof).
 */
function Lead() {
  const r = LEAD.result;
  return (
    <section id="proof" className="sant-results__hero sant-results__lead" aria-labelledby="results-lead">
      <p className="sant-results__kicker">Pre-registered · run once</p>
      <h1 id="results-lead" className="sant-display sant-results__title">
        {LEAD.headline}
      </h1>
      <div className="sant-results__sub">
        <p className="sant-lede">
          A camera policy that started from {LEAD.demos} human mouse demos, through SANT and an RL teacher, completed{" "}
          <span className="sant-num">
            {r.k} of {r.n}
          </span>{" "}
          fresh scenes (seeds <span className="sant-num">{r.seeds}</span>), 95% CI{" "}
          <span className="sant-num">
            {formatStat(100 * r.ci[0], 1)}–{formatStat(100 * r.ci[1], 1)}%
          </span>
          . The goal, written down before the test, was at least{" "}
          <span className="sant-num">
            {LEAD.goal.k}/{LEAD.goal.n}
          </span>
          . The test ran once.
        </p>
        <p className="sant-results__cites">
          <ProofCite source={r.source} prefix="Result: " />
          <ProofCite source={LEAD.goal.source} prefix="Goal: " />
          <ProofCite source={LEAD.demosSource} prefix="Demos: " />
        </p>
      </div>
    </section>
  );
}

/** The earlier result (scripted source demos), below the proof. */
function Headline() {
  return (
    <section className="sant-results__hero sant-results__earlier" aria-labelledby="results-title">
      <p className="sant-results__kicker">An earlier result, from scripted demos</p>
      <h2 id="results-title" className="sant-display sant-results__title sant-results__title--earlier">
        {HEADLINE.title}
      </h2>
      <div className="sant-results__sub">
        <p className="sant-lede">
          {HEADLINE.text} {HEADLINE.replicates}
        </p>
        <p className="sant-results__so-far">{PROOF_SO_FAR.text}</p>
      </div>
      <div className="sant-notes">
        <div className="sant-results__proof">
          <CountUpTiles
            from={RAW.k}
            to={X100.k}
            suffix={`/${X100.n}`}
            label={`new scenes completed once 100 verified copies were added, up from ${RAW.k}/${RAW.n} with the 10 demos alone`}
          />
          <table className="sant-results__ledger" aria-label="The headline result">
            <thead>
              <tr>
                <th scope="col">Training data</th>
                <th scope="col">Successes</th>
                <th scope="col">Rate</th>
                <th scope="col">95% CI</th>
              </tr>
            </thead>
            <tbody>
              {ARMS.map((a) => (
                <tr key={a.key} data-arm={a.key}>
                  <th scope="row">{a.label}</th>
                  <td className="sant-num">
                    {a.k}/{a.n}
                  </td>
                  <td className="sant-num">{formatStat((100 * a.k) / a.n, 1)}%</td>
                  <td className="sant-num">{a.ci.text}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  Fisher exact, two-sided, against the 10 demos alone: p = <span className="sant-num">{COMPARISONS.rawVs100.p}</span>{" "}
                  with 100 copies, p = <span className="sant-num">{COMPARISONS.rawVs300.p}</span> with 300.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <aside className="sant-margin-note">
          <p>
            The 40 scenes (seeds <span className="sant-num">{SCENES.seeds}</span>) were fixed before the run and never used to
            choose anything.
          </p>
          <p>
            Each copy is one of the 10 demos re-planned for a new cube and bin position, and kept only if it passed the physics
            check in Isaac Lab:{" "}
            <span className="sant-num">
              {VERIFIED.x100.k}/{VERIFIED.x100.n}
            </span>{" "}
            and{" "}
            <span className="sant-num">
              {VERIFIED.x300.k}/{VERIFIED.x300.n}
            </span>{" "}
            did.
          </p>
          <Cite source={{ note: "t3", lines: "1156, 1307" }} prefix="Counts: " />
          <Cite source={{ note: "t3", lines: "1131, 1156, 1313" }} prefix="p: " />
          <Cite source={HEADLINE.source} prefix="Sentence: " />
          <Cite source={HEADLINE.replicatesSource} prefix="Replication: " />
          <Cite source={SCENES.source} prefix="Scenes: " />
          <Cite source={VERIFIED.x100.source} prefix="Copies: " />
          <Cite source={VERIFIED.x300.source} prefix="" />
          <Cite source={PROOF_SO_FAR.source} prefix="Source demos: " />
        </aside>
      </div>
    </section>
  );
}

function Limits() {
  return (
    <section className="sant-results__section" aria-labelledby="results-limits">
      <SectionHeader id="results-limits" title="What it doesn't show yet" />
      <ul className="sant-results__limits" aria-label="Limits of the result">
        {LIMITS.map((l) => (
          <li key={l.text}>
            <p>{l.text}</p>
            {l.sources.map((s, i) => (
              <Cite key={i} source={s} prefix={i === 0 ? "Source: " : ""} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Real() {
  return (
    <section className="sant-results__section" aria-labelledby="results-real">
      <SectionHeader
        id="results-real"
        title="Real demos"
        lede="The result above is on scripted demos. These are a real person's: 10 webcam demos, the blind repair test on them, and tonight's 10 mouse demos. Every number is read from the experiment stores and links to its note."
      />
      {REAL.map((e) => (
        <ExperimentSection key={e.id} e={e} />
      ))}
    </section>
  );
}

function Copies() {
  const sources = `${cite({ note: "t3", lines: "1156, 1307, 1367–1371" })}`;
  return (
    <section className="sant-results__section" aria-labelledby="results-copies">
      <SectionHeader
        id="results-copies"
        title="Did 300 copies beat 100? Not at this training budget."
        lede="We trained the same policy three times on the same 10 demos, with 0, 100 and 300 verified copies added, and ran each one on the same 40 new scenes."
      />
      <div className="sant-notes">
        <ChartFrame
          title="Success on the same 40 new scenes"
          caption="ACT, 30k training steps each. The chart replays the runs scene by scene, in the order they ran: each square is one scene, filled if the robot put the cube in the bin. The bar through each point is the 95% Wilson CI of the scenes so far, so it narrows as scenes come in."
          source={sources}
        >
          <CopiesChart />
        </ChartFrame>
        <aside className="sant-margin-note sant-results__plateau">
          <p>{PLATEAU.text}</p>
          <Cite source={PLATEAU.source} />
          <dl className="sant-results__tests">
            <div>
              <dt>0 vs 100 copies</dt>
              <dd>
                p = <span className="sant-num">{COMPARISONS.rawVs100.p}</span>
              </dd>
            </div>
            <div>
              <dt>0 vs 300 copies</dt>
              <dd>
                p = <span className="sant-num">{COMPARISONS.rawVs300.p}</span>
              </dd>
            </div>
            <div>
              <dt>100 vs 300 copies</dt>
              <dd>
                p = <span className="sant-num">{COMPARISONS.x100Vs300.p}</span>
              </dd>
            </div>
          </dl>
          <p>Fisher exact, two-sided.</p>
          <Cite source={{ note: "t3", lines: "1156, 1313–1314" }} />
          <p className="sant-results__passes">Training passes over each example, at 30k steps:</p>
          <dl className="sant-results__tests">
            {ARMS.map((a) => (
              <div key={a.key}>
                <dt>{a.copies} copies</dt>
                <dd>{a.epochs.text}</dd>
              </div>
            ))}
          </dl>
          <Cite source={{ note: "t3", lines: "1167, 1257" }} />
        </aside>
      </div>
    </section>
  );
}

function Cards() {
  return (
    <section className="sant-results__section" aria-labelledby="results-card">
      <SectionHeader
        id="results-card"
        title="The report card"
        lede="Every robot that goes through SANT gets one: how often it succeeds, why it fails, and how far it reaches. Here it is for the three arms we ran, next to the slot for yours."
      />
      <div className="sant-results__cards">
        {REPORT_CARDS.map((c) => (
          <ReportCard key={c.key} card={c} />
        ))}
      </div>
    </section>
  );
}

function More() {
  return (
    <>
      {MORE.map((e) => (
        <ExperimentSection key={e.id} e={e} />
      ))}
    </>
  );
}

function Pending() {
  return (
    <section className="sant-results__section" aria-labelledby="results-pending">
      <SectionHeader
        id="results-pending"
        title="Not measured yet"
        lede="Designed and pre-registered, but not run. Nothing here is a result: every count says Pending until the run happens."
      />
      {PENDING.map((e) => (
        <ExperimentSection key={e.id} e={e} />
      ))}
    </section>
  );
}

function Sources() {
  return (
    <section className="sant-results__section sant-results__sources" aria-labelledby="results-sources">
      <SectionHeader
        id="results-sources"
        level={3}
        title="Where the numbers come from"
        lede={`Every number on this page comes from web/src/site/results/results.json (as of ${RESULTS.asOf}), from stores.json for the real demos, generated read-only from the experiment stores by scripts/build_site_results.py (newest store file ${RESULTS.storesAsOf ?? "unknown"}), or, for the pre-registered proof, from web/src/site/results/proofData.ts. Each cites a line in one of these notes, or the store file it was read from. The notes are append-only, so the lines stay put.`}
      />
      <ul>
        {[...Object.values(NOTES), ...Object.values(PROOF_NOTES)].map((n) => (
          <li key={n.path}>
            {n.name}: <code>{n.path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResultsPage() {
  return (
    <StoryShell home="/site" links={LINKS} cta={CTA}>
      <div className="sant-results">
        <Lead />
        <ProofSection />
        <Headline />
        <Limits />
        <Real />
        <Copies />
        <More />
        <Cards />
        <ExperimentSection e={experiment("byor")} />
        <Pending />
        <Sources />
      </div>
    </StoryShell>
  );
}
