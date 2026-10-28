// The whole pipeline (/flow), end to end: Record → Measure → Repair → Verify → Multiply → Teach → Train → Evaluate →
// Analyse → Recipe, and from Recipe back to Multiply (the closed loop, scripts/sant_loop.py). Each stage says what it
// does in one line, shows its real number from GET /flow (app/routers/flow.py) and links to the page that shows it.
// The backend down or a malformed reply: the committed numbers (model.ts FALLBACK), said so on the page.
// Motion: one light runs down the spine on load, and one runs up the loop's return line; both off with reduced motion.
import { apiUrl } from "../../api/client";
import { useAsync } from "../data/hooks";
import { HandoffLink, HoloPage, HoloPanel, HoloTag } from "../holo/Holo";
import { REPO_BLOB } from "../results/data";
import { CYCLE_FROM, FALLBACK, LOOP_STAGES, loopLine, parseFlow, rateText, type Flow, type Loop, type Rate, type Stage } from "./model";
import "./flow.css";

type Fetch = typeof fetch;

async function fetchFlow(f: Fetch): Promise<Flow> {
  const res = await f(apiUrl("/flow"));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFlow(await res.json());
}

const PAGE_NAME: Record<string, string> = {
  "/record": "Record",
  "/pm/review": "Review",
  "/data": "Data",
  "/site/results": "Results",
  "/metrics": "Metrics",
  "/test-track": "Test track",
  "/analysis": "Analyst",
  "/pipeline": "Pipeline",
};

function Bars({ before, after }: { before?: Rate; after?: Rate }) {
  const rows = [before && { r: before, kind: "before" }, after && { r: after, kind: "after" }].filter(Boolean) as { r: Rate; kind: string }[];
  if (!rows.length) return null;
  return (
    <svg className="fl-bars" viewBox={`0 0 200 ${rows.length * 14}`} preserveAspectRatio="none" aria-hidden="true">
      {rows.map(({ r, kind }, i) => {
        const y = i * 14 + 3;
        return (
          <g key={kind} className={`fl-bar fl-bar--${kind}`}>
            <rect className="fl-bar__track" x="0" y={y} width="200" height="8" />
            <rect className="fl-bar__fill" x="0" y={y} width={(200 * r.k) / r.n} height="8" />
            {r.ci && <line className="fl-bar__ci" x1={200 * r.ci[0]} x2={200 * r.ci[1]} y1={y + 4} y2={y + 4} />}
          </g>
        );
      })}
    </svg>
  );
}

function StageRow({ s, index }: { s: Stage; index: number }) {
  const m = s.metric;
  return (
    <li className="fl-stage" data-stage={s.id}>
      <span className="fl-node" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="fl-what">
        <h3 className="fl-title">{s.title}</h3>
        <p className="fl-does">{s.does}</p>
      </div>
      <div className="fl-metric">
        <p className="fl-headline">{m.headline}</p>
        <Bars before={m.before} after={m.after} />
        {(m.before || m.after) && (
          <p className="fl-legend">
            {m.before && <span className="fl-legend__before">before {rateText(m.before)}</span>}
            {m.after && <span className="fl-legend__after">after {rateText(m.after)}</span>}
          </p>
        )}
        {m.detail && <p className="fl-detail">{m.detail}</p>}
        <p className="fl-source">
          {s.source.note ? (
            <a href={`${REPO_BLOB}/${s.source.note}`} target="_blank" rel="noreferrer">
              {s.source.label}
            </a>
          ) : (
            s.source.label
          )}
          {s.source.kind === "cache" && " (cached run)"}
        </p>
      </div>
      <HandoffLink className="fl-open" to={s.link} label={PAGE_NAME[s.link] ?? s.title}>
        See it on {PAGE_NAME[s.link] ?? "its page"}
      </HandoffLink>
    </li>
  );
}

function LoopStatus({ loop }: { loop: Loop }) {
  const state = loop.status === "failed" ? "fail" : loop.status === "done" ? "pass" : loop.status === "running" ? "live" : undefined;
  return (
    <HoloPanel className="fl-loop" state={state} aria-label="The closed loop">
      <div className="fl-loop__head">
        <HoloTag dot={loop.status === "running"}>Closed loop</HoloTag>
        <p className="fl-loop__line" aria-live="polite">
          {loopLine(loop)}
        </p>
      </div>
      <ol className="fl-loop__stages" aria-label="Loop stages">
        {LOOP_STAGES.map((l) => {
          const st = loop.status === "none" ? "pending" : (loop.stages.find((x) => x.id === l.id)?.status ?? "pending");
          return (
            <li key={l.id} className="fl-chip" data-status={st}>
              <span className="fl-chip__label">{l.label}</span>
              <span className="fl-chip__status">{st === "provided" ? "given" : st}</span>
            </li>
          );
        })}
      </ol>
      {loop.status !== "none" && loop.seeds && (
        <p className="fl-loop__seeds">
          Both arms on fresh seeds {loop.seeds[0]}–{loop.seeds[1]}; decided by a two-sided Fisher test, p ≤ 0.05 with the recipe ahead, written down before
          training.
        </p>
      )}
      {loop.status === "none" && (
        <p className="fl-loop__seeds">
          On the GPU machine, <code>uv run python scripts/sant_loop.py</code> runs it: diagnose, freeze the recipe, train a recipe arm and a
          uniform control, evaluate both on the same fresh seeds, compare.
        </p>
      )}
    </HoloPanel>
  );
}

export function FlowPage({ fetchImpl = fetch }: { fetchImpl?: Fetch }) {
  const loaded = useAsync("flow", () => fetchFlow(fetchImpl));
  const flow = loaded.state === "ok" ? loaded.value : FALLBACK;
  const cut = flow.stages.findIndex((s) => s.id === CYCLE_FROM);
  const line = flow.stages.slice(0, cut);
  const cycle = flow.stages.slice(cut);

  return (
    <HoloPage title="Flow" here="flow">
      <div className="fl">
        <header className="fl-hero">
          <h2 className="fl-hero__title">Ten human demos in, a camera policy that lands 30 of 40 after SANT and an RL teacher, and a loop that asks what data to make next.</h2>
          <p className="fl-hero__lede">
            Every stage below is a real step with a measured number, in the order the data moves. From Multiply on, it is a loop: Nemotron
            reads the failures, the recipe picks the next scenes, and a controlled A/B decides whether the recipe helped.
          </p>
        </header>

        {loaded.state === "error" && (
          <HoloPanel className="fl-offline" state="fail" role="status">
            The backend isn’t reachable, so these are the committed numbers as of {FALLBACK.as_of}. Start the API to see the cached analysis and the
            loop's live state.
          </HoloPanel>
        )}

        <LoopStatus loop={flow.loop} />

        <ol className="fl-track" aria-label="The pipeline, stage by stage" aria-busy={loaded.state === "loading"}>
          {line.map((s, i) => (
            <StageRow key={s.id} s={s} index={i} />
          ))}
          <li className="fl-cycle-wrap">
            <div className="fl-cycle" role="group" aria-label="The loop: Multiply to Recipe, then back to Multiply">
              <ol className="fl-cycle__list">
                {cycle.map((s, i) => (
                  <StageRow key={s.id} s={s} index={cut + i} />
                ))}
              </ol>
              <span className="fl-return" aria-hidden="true">
                <span className="fl-return__light" />
              </span>
              <p className="fl-return__label">Back to Multiply: the recipe picks the scenes multiplied next.</p>
            </div>
          </li>
        </ol>
      </div>
    </HoloPage>
  );
}

export default FlowPage;
