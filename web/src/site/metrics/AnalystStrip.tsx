// Nemotron as the failure analyst, on the final model (GET /analysis/bigtest_final): what it read, which of its
// claims the code kept or sent back, what it cost, and its verdict. A strip, not the analyst page: the link goes there.
// Unreachable backend: one quiet line and the link, never a broken page.
import { Link } from "react-router-dom";
import type { Async } from "../data/hooks";
import type { Analysis } from "../analysis/model";
import { analystSummary } from "./model";

export function AnalystStrip({ final }: { final: Async<Analysis> }) {
  const s = final.state === "ok" ? analystSummary(final.value) : null;
  return (
    <section className="mx-section mx-analyst" aria-labelledby="mx-analyst-h">
      <div className="mx-analyst__head">
        <h2 id="mx-analyst-h" className="mx-h2">
          What Nemotron made of the failures
        </h2>
        <p className="mx-lede">NVIDIA Nemotron proposes where the next round's data should go; code checks each claim against the episodes and sends back any it can't support.</p>
      </div>
      {final.state === "loading" && <p className="mx-quiet">Reading the analyst's last run…</p>}
      {final.state === "error" && (
        <p className="mx-quiet">
          Couldn't reach the analyst backend, so its run isn't shown here. <Link to="/analysis">Open the analyst page</Link>
        </p>
      )}
      {final.state === "ok" && !s && (
        <p className="mx-quiet">
          Nemotron hasn't been asked about the final model yet. <Link to="/analysis">Open the analyst page</Link>
        </p>
      )}
      {s && (
        <>
          <dl className="mx-analyst__grid">
            <div>
              <dt>Episodes analysed</dt>
              <dd className="mx-analyst__big">{s.episodes}</dd>
            </div>
            <div>
              <dt>Claims</dt>
              <dd>
                <b>{s.kept}</b> kept, <b>{s.sentBack}</b> sent back by the code
                {s.noAnswer > 0 && (
                  <>
                    , <b>{s.noAnswer}</b> unanswered
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd className="mx-num">{s.cost}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd className="mx-num mx-analyst__model">{s.model ?? "unknown"}</dd>
            </div>
            <div className="mx-analyst__verdict" data-weak={s.weak ? "true" : undefined}>
              <dt>Verdict</dt>
              <dd>{s.verdict}</dd>
            </div>
          </dl>
          <p className="mx-foot">
            {s.weak ? "A weak lead is something to test on fresh seeds, not a finding. " : ""}
            <Link to="/analysis">See every claim on the analyst page</Link>
          </p>
        </>
      )}
    </section>
  );
}
