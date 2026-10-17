// "Perfect this demo": start the backend job, then poll it to the end.
// A mock job (backend without the route) is labelled as one and never
// links a demo.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GlassCard, StatusPill } from "../../components";
import { describeError, pmApi } from "../api";
import { createMockJobs, pollJob, startPerfect, type Diagnoser, type Job } from "../jobs";
import type { Demo } from "../types";

const mockJobs = createMockJobs();

type Run =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "polling"; job: Job | null; mock: boolean }
  | { state: "error"; message: string };

const STEPS = [
  { key: "queued", label: "Queued" },
  { key: "running", label: "Perfecting" },
  { key: "succeeded", label: "Done" },
] as const;

const STATUS_TEXT = { queued: "Queued", running: "Running", succeeded: "Finished", failed: "Failed" } as const;

function Steps({ job }: { job: Job | null }) {
  const status = job?.status ?? "queued";
  const reached = status === "failed" ? -1 : STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="pm-steps" aria-hidden="true">
      {STEPS.map((s, i) => {
        const cls =
          status === "failed" ? "is-failed" : i < reached || status === "succeeded" ? "is-done" : i === reached ? "is-current" : "";
        return (
          <li key={s.key} className={`pm-step ${cls}`}>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export default function PerfectPanel({ demo, pollIntervalMs }: { demo: Demo; pollIntervalMs: number }) {
  const [diagnoser, setDiagnoser] = useState<Diagnoser>("rules");
  const [run, setRun] = useState<Run>({ state: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function perfect() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRun({ state: "starting" });
    try {
      const started = await startPerfect(pmApi, mockJobs, demo.id, diagnoser);
      if (ctrl.signal.aborted) return;
      setRun({ state: "polling", job: null, mock: started.mock });
      await pollJob(started.backend, started.jobId, {
        intervalMs: pollIntervalMs,
        signal: ctrl.signal,
        onUpdate: (job) => !ctrl.signal.aborted && setRun({ state: "polling", job, mock: started.mock }),
      }).then((job) => job && !ctrl.signal.aborted && setRun({ state: "polling", job, mock: started.mock }));
    } catch (e) {
      if (!ctrl.signal.aborted) setRun({ state: "error", message: describeError(e) });
    }
  }

  const busy = run.state === "starting" || (run.state === "polling" && (!run.job || !["succeeded", "failed"].includes(run.job.status)));
  const canPerfect = demo.source === "human";

  return (
    <GlassCard as="section" className="stack">
      <h2>Perfect</h2>
      {canPerfect ? (
        <>
          <p className="muted small">
            Diagnose, repair from the fixed menu, then replay in Isaac Lab. The sim worker must be running.
          </p>
          <fieldset className="pm-radio-row" disabled={busy}>
            <legend className="sr-only">Diagnoser</legend>
            <label>
              <input type="radio" name="diagnoser" checked={diagnoser === "rules"} onChange={() => setDiagnoser("rules")} />
              <span>
                Rules detector <span className="muted">free</span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="diagnoser"
                checked={diagnoser === "nemotron"}
                onChange={() => setDiagnoser("nemotron")}
              />
              <span>
                Nemotron 3.5 Super VL <span className="muted">billed Token Factory call</span>
              </span>
            </label>
          </fieldset>
          <button type="button" className="primary-button" onClick={perfect} disabled={busy}>
            Perfect this demo
          </button>
        </>
      ) : (
        <p className="muted small">
          Perfecting starts from a human demo. This one is {demo.source}
          {demo.parent_id && (
            <>
              ; its parent is <Link to={`/pm/review?id=${encodeURIComponent(demo.parent_id)}`}>{demo.parent_id}</Link>
            </>
          )}
          .
        </p>
      )}

      {run.state === "starting" && <StatusPill>Starting…</StatusPill>}
      {run.state === "error" && (
        <p className="small" role="alert">
          {run.message}
        </p>
      )}
      {run.state === "polling" && (
        <div className="stack" aria-live="polite">
          {run.mock && (
            <StatusPill tone="warm" title="POST /demos/{id}/perfect isn't on this backend yet">
              Mock job: nothing is perfected
            </StatusPill>
          )}
          <Steps job={run.job} />
          <p className="small">{STATUS_TEXT[run.job?.status ?? "queued"]}</p>
          {run.job?.status === "succeeded" && run.job.outcome && <p className="small">Outcome: {run.job.outcome}</p>}
          {run.job?.status === "failed" && run.job.error && <p className="small muted">{run.job.error}</p>}
          {run.job?.status === "succeeded" && run.job.demoId && (
            <Link className="pill-link" to={`/pm/review?id=${encodeURIComponent(run.job.demoId)}`}>
              Open the perfected demo
            </Link>
          )}
        </div>
      )}
    </GlassCard>
  );
}
