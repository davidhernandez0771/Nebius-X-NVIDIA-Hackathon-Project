// The pipeline bar, on every stage page: each stage as a link with its state (done, running with its progress,
// pending), the run's time spent and left, and "Waiting for the GPU" while it queues. `search` rides along on the
// stage links (the example's ?speed=). The stages sit on a conduit (pipeline.css) that fills with the work done
// (conduitOf): one node per stage, the running one ringed by its progress.
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { LiveConn } from "../data/hooks";
import { conduitOf, formatDuration, stageOf, stagesFor, type Bar, type RunState, type StageId } from "./model";

const CONN: Record<LiveConn, string> = { connecting: "connecting…", open: "live", closed: "" };

export function PipelineBar({ run, bar, shown, conn, search = "", example = false }: { run: RunState; bar: Bar; shown: StageId; conn: LiveConn; search?: string; example?: boolean }) {
  const stages = stagesFor(run.kind);
  // The example plays from a script in the browser: its stream is "open" like a real one, but it is never live.
  const connLabel = example ? "example" : CONN[conn];
  const left = /^(done|failed|cancelled|dry run)/.test(bar.remaining) ? bar.remaining : `${bar.remaining} left`;
  return (
    <nav className="pipe-bar holo-panel" aria-label="Pipeline">
      <div className="pipe-bar__head">
        <h2 className="pipe-bar__name">{run.name || run.id}</h2>
        <p className="pipe-bar__time">
          {/* a run cancelled before it started spent nothing */}
          {bar.elapsed !== "—" && <span>{bar.elapsed} spent</span>}
          <span>{left}</span>
          {connLabel && <span className="pipe-bar__conn">{connLabel}</span>}
        </p>
      </div>
      {bar.waiting && (
        <p className="pipe-bar__wait" role="status">
          <span className="pipe-dot" aria-hidden="true" /> {bar.waiting}
        </p>
      )}
      <div className="pipe-stages" style={{ "--pipe-n": stages.length, "--pipe-fill": conduitOf(run).toFixed(4) } as CSSProperties}>
        <ol>
          {stages.map((s) => {
            const st = stageOf(run, s.id);
            const pct = Math.round(st.progress * 100);
            // A dry run skips every stage but plans each: show what it would take (0 s: a stage it won't run at all).
            const planned = (st.status === "pending" || (st.status === "skipped" && run.plan_s !== null && (st.eta_s ?? 0) > 0)) && st.eta_s !== null;
            return (
              <li key={s.id}>
                <Link
                  className="pipe-stage"
                  to={`/pipeline/${encodeURIComponent(run.id)}/${s.id}${search}`}
                  data-status={st.status}
                  aria-current={s.id === shown ? "page" : undefined}
                  title={st.detail ?? s.blurb}
                >
                  <span className="pipe-stage__node" aria-hidden="true" style={{ "--pipe-p": st.status === "done" ? 1 : st.progress } as CSSProperties} />
                  <span className="pipe-stage__label">{s.label}</span>
                  <span className="pipe-stage__state">
                    {st.status === "running" ? `${pct}%${st.eta_s !== null ? ` · ${formatDuration(st.eta_s)}` : ""}` : planned ? `~${formatDuration(st.eta_s)}` : st.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
