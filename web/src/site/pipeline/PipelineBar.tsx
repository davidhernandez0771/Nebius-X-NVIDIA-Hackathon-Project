// The pipeline bar, on every stage page: each stage as a link with its state (done, running with its progress,
// pending), the run's time spent and left, and "Waiting for the GPU" while it queues. `search` rides along on the
// stage links (the example's ?speed=).
import { Link } from "react-router-dom";
import type { LiveConn } from "../data/hooks";
import { formatDuration, stageOf, stagesFor, type Bar, type RunState, type StageId } from "./model";

const CONN: Record<LiveConn, string> = { connecting: "connecting…", open: "live", closed: "" };

export function PipelineBar({ run, bar, shown, conn, search = "" }: { run: RunState; bar: Bar; shown: StageId; conn: LiveConn; search?: string }) {
  const left = /^(done|failed|cancelled|dry run)/.test(bar.remaining) ? bar.remaining : `${bar.remaining} left`;
  return (
    <nav className="pipe-bar" aria-label="Pipeline">
      <div className="pipe-bar__head">
        <h2 className="pipe-bar__name">{run.name || run.id}</h2>
        <p className="pipe-bar__time">
          {/* a run cancelled before it started spent nothing */}
          {bar.elapsed !== "—" && <span>{bar.elapsed} spent</span>}
          <span>{left}</span>
          {CONN[conn] && <span className="pipe-bar__conn">{CONN[conn]}</span>}
        </p>
      </div>
      {bar.waiting && (
        <p className="pipe-bar__wait" role="status">
          <span className="pipe-dot" aria-hidden="true" /> {bar.waiting}
        </p>
      )}
      <div className="pipe-stages">
        <ol>
          {stagesFor(run.kind).map((s) => {
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
                  <span className="pipe-stage__label">{s.label}</span>
                  <span className="pipe-stage__state">
                    {st.status === "running" ? `${pct}%${st.eta_s !== null ? ` · ${formatDuration(st.eta_s)}` : ""}` : planned ? `~${formatDuration(st.eta_s)}` : st.status}
                  </span>
                  <span className="pipe-stage__meter" aria-hidden="true">
                    <i style={{ width: `${st.status === "done" ? 100 : pct}%` }} />
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
