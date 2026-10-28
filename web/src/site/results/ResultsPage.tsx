// The Results page, in the work pages' holo look (HoloPage, like Record, Pipeline and Data): the headline 30/40, the
// pre-registered proof (./ProofSection.tsx, the same results as the story's proof beats and the workshop's proof wall),
// then the earlier, smaller experiments that led to it, what it doesn't show, and where every number comes from.
// Only finished results: no pending runs, no previews (the user, 2026-10-28). Every number comes from ./proofData.ts or
// ./results.json + ./stores.json (via ./data.ts and ./facts.ts) and sits next to its note and line.
import { Link } from "react-router-dom";
import { SectionHeader } from "../../sant/components/SectionHeader";
import { formatStat } from "../../sant/motion/format";
import { HoloPage } from "../holo/Holo";
import { Cite } from "./Cite";
import { experiment } from "./data";
import { ExperimentSection } from "./ExperimentSection";
import { ProofCite, ProofSection } from "./ProofSection";
import { LEAD, PROOF_NOTES } from "./proofData";
import { ARMS, COMPARISONS, HEADLINE, NOTES, SCENES, VERIFIED } from "./facts";
import "./results.css";

/** The earlier experiments, all finished: the real webcam demos and the blind repair test on them, the centred
 *  approach, and Nemotron as labeler and judge. (The mouse demos' raw-vs-SANT test is the climb's first two bars.) */
const EARLIER = ["webcam", "repair_ab", "grasp_fix", "nemotron"].map(experiment);

/**
 * What the page leads with (site-nav, 2026-10-26): the newest pre-registered one-shot result, from ./proofData.ts
 * (LEAD). The home page's "See the result" links here (#proof).
 */
function Lead() {
  const r = LEAD.result;
  return (
    <section id="proof" className="sant-results__hero sant-results__lead" aria-labelledby="results-lead">
      <p className="sant-results__kicker">Pre-registered · run once</p>
      <h2 id="results-lead" className="sant-display sant-results__title">
        {LEAD.headline}
      </h2>
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
        <Next />
      </div>
    </section>
  );
}

/** Where to go from here: the 40 runs themselves, and Record. */
function Next() {
  return (
    <nav className="sant-results__next" aria-label="See it run">
      <Link className="sant-results__go" to="/test-track">
        Watch the 40 test runs →
      </Link>
      <Link className="sant-results__go" to="/record">
        Record a demo →
      </Link>
    </nav>
  );
}

/** The first multiply result (scripted source demos), the first of the earlier experiments. */
function Multiply() {
  return (
    <section className="sant-results__section" aria-labelledby="results-title">
      <SectionHeader id="results-title" title={HEADLINE.title} lede={`${HEADLINE.text} ${HEADLINE.replicates}`} />
      <div className="sant-notes">
        <div className="sant-results__proof">
          <table className="sant-results__ledger" aria-label="The multiply result">
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
            The 10 source demos came from a scripted expert, so this tested multiplying, not cleaning up. The 40 scenes (seeds{" "}
            <span className="sant-num">{SCENES.seeds}</span>) were fixed before the run.
          </p>
          <p>
            Each copy was kept only if it passed the physics check in Isaac Lab:{" "}
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
        </aside>
      </div>
    </section>
  );
}

function Earlier() {
  return (
    <section className="sant-results__band" aria-labelledby="results-earlier">
      <SectionHeader
        id="results-earlier"
        title="Before the proof: the earlier experiments"
        lede="Smaller tests from the first week, before the RL teacher. Each one is finished, and each shaped what we did next."
      />
      <Multiply />
      {EARLIER.map((e) => (
        <ExperimentSection key={e.id} e={e} />
      ))}
    </section>
  );
}

/** What none of it shows. */
function Limits() {
  return (
    <section className="sant-results__section" aria-labelledby="results-limits">
      <SectionHeader id="results-limits" title="What it doesn't show" />
      <ul className="sant-results__limits" aria-label="Limits of the result">
        <li>
          <p>Everything is in simulation (Isaac Lab). No real robot has run it yet.</p>
        </li>
        <li>
          <p>One task (a 5 cm cube into a bin), one arm (Franka), one policy type (ACT).</p>
        </li>
        <li>
          <p>
            One training run per recipe. v2's two changes (longer training and the gripper deadband) were tested together, so
            the gain can't be split between them.
          </p>
        </li>
        <li>
          <p>v2 was tested on fresh seeds and the earlier recipes on another block, so the climb's steps are compared descriptively.</p>
        </li>
      </ul>
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
        lede="Every number on this page comes from web/src/site/results/proofData.ts (the proof), results.json, or stores.json (read-only from the experiment stores by scripts/build_site_results.py). Each cites a line in one of these notes, or the store file it was read from. The notes are append-only, so the lines stay put."
      />
      <ul>
        {[...Object.values(PROOF_NOTES), ...Object.values(NOTES)].map((n) => (
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
    <HoloPage title="Results" here="results">
      <div className="sant-results sant-results--holo">
        <Lead />
        <ProofSection />
        <Earlier />
        <Limits />
        <Sources />
      </div>
    </HoloPage>
  );
}
