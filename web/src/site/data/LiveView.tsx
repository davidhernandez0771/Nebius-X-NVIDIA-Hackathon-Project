// SANT working live: a running experiment as it happens. The pipeline's stages light up in order, each demo's
// verdicts arrive, and every multiplied variant pops in with the simulator's footage and its physics badge.
// Read only: it watches the experiment's store (GET /showcase/live/{name}); it never starts a job.
import { fetchFootage, liveUrl, type Fetch } from "./api";
import { FootageView } from "./FootageView";
import { useMotion } from "../../sant/motion/MotionProvider";
import { useAsync, useClock, useLiveFeed } from "./hooks";
import { STAGES, type FeedState, type FeedVariant } from "./liveFeed";
import { VerdictBadge } from "./Pane";
import { demoName, reasonText, verdictOf } from "./model";

const VARIANTS_SHOWN = 24;

function LiveVariant({ name, v, t, fetchImpl }: { name: string; v: FeedVariant; t: number; fetchImpl?: Fetch }) {
  const footage = useAsync(`${name}:${v.id}`, () => fetchFootage(name, { id: v.id, live: false }, "front", fetchImpl));
  return (
    <li className="data-variant data-variant--live">
      <FootageView footage={footage.state === "ok" ? footage.value : null} t={t} label={`Isaac Sim front camera, variant ${v.seed ?? v.id}`} />
      <span className="data-variant__name">
        {demoName(v.source)} · variant {v.seed ?? "?"}
      </span>
      <VerdictBadge verdict={verdictOf(v)} />
    </li>
  );
}

function Stages({ feed }: { feed: FeedState }) {
  return (
    <ol className="data-stages" aria-label="SANT's pipeline">
      {STAGES.map((s) => (
        <li key={s.id} className="data-stage" data-status={feed.stages[s.id]}>
          <span className="data-stage__dot" aria-hidden="true" />
          <span className="data-stage__label">{s.label}</span>
          <span className="data-stage__status">{feed.stages[s.id] === "done" ? "done" : feed.stages[s.id] === "running" ? "running" : "waiting"}</span>
        </li>
      ))}
    </ol>
  );
}

export function LiveView({ name, fetchImpl, Source }: { name: string; fetchImpl?: Fetch; Source?: typeof EventSource }) {
  const [feed, conn] = useLiveFeed(liveUrl(name), Source);
  const verified = feed.variants.filter((v) => v.success).length;
  const { reduced } = useMotion();
  // Every variant's footage loops on one clock (a variant runs about 8 s).
  const [t] = useClock(9, !reduced, 20);
  return (
    <div className="data-live">
      <p className="data-live__conn" role="status">
        {conn === "open" ? "Watching" : conn === "connecting" ? "Connecting…" : feed.ended ? "The run's record ends here" : "Not connected"}
        {feed.lastAt && <> · last update {feed.lastAt}</>}
      </p>
      <Stages feed={feed} />
      <section aria-labelledby="data-live-demos" className="data-live__demos">
        <h3 id="data-live-demos" className="data-h3">
          Demos
        </h3>
        <ul className="data-live__grid">
          {feed.ids.map((id) => {
            const d = feed.demos[id] ?? {};
            return (
              <li key={id} className="data-live__demo" data-done={d.multiply ? "true" : undefined}>
                <span className="data-demo__name">{demoName(id)}</span>
                <span className="data-demo__chips">
                  {d.physics ? (
                    <span className={`data-chip ${d.physics.success ? "is-pass" : "is-fail"}`} title={d.physics.reasons.map(reasonText).join(", ")}>
                      Physics {d.physics.success ? "✓" : "✕"}
                    </span>
                  ) : (
                    <span className="data-chip is-wait">Physics…</span>
                  )}
                  {d.repair && <span className={`data-chip ${d.repair.status === "perfected" ? "is-pass" : "is-fail"}`}>{d.repair.status === "perfected" ? `Repaired (${d.repair.repairs})` : "Discarded"}</span>}
                  {d.multiply && (
                    <span className="data-chip">
                      {d.multiply.k}/{d.multiply.n} variants
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="data-live-variants" className="data-live__variants">
        <h3 id="data-live-variants" className="data-h3">
          Variants as they're verified: {verified} of {feed.variants.length}
        </h3>
        <ul className="data-variants__grid" aria-live="polite">
          {feed.variants.slice(0, VARIANTS_SHOWN).map((v) => (
            <LiveVariant key={v.id} name={name} v={v} t={t} fetchImpl={fetchImpl} />
          ))}
        </ul>
      </section>
      {(feed.train.length > 0 || feed.evals.length > 0) && (
        <section aria-labelledby="data-live-result" className="data-live__result">
          <h3 id="data-live-result" className="data-h3">
            Training on the verified data
          </h3>
          <ul className="data-list">
            {feed.train.map((c) => (
              <li key={`t-${c.cell}`}>
                {c.cell}: final loss {c.loss}
              </li>
            ))}
            {feed.evals.map((c) => (
              <li key={`e-${c.cell}`}>
                {c.cell}: {c.k}/{c.n} on unseen scenes
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
