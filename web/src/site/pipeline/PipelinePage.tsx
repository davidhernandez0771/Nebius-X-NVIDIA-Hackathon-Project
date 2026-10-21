// The pipeline (/pipeline): every SANT stage after Record as a page you can follow live, with its time left, ending
// in the download of your data. /pipeline lists the runs and starts one (on the demos just recorded: ?demos=a,b);
// /pipeline/{run}/{stage} follows a run, the pipeline bar on top (where it is, time spent and left, the GPU queue),
// with Cancel and Resume. Until the pipeline API is on the server (pm/pipeline-api) the list says so and offers the
// example run (stub.ts).
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import { useAsync } from "../data/hooks";
import "../data/data.css";
import { cancelRun, fetchRuns, resumeRun, type Fetch } from "./api";
import { useRun } from "./hooks";
import { barOf, stagesFor, type RunState, type StageId } from "./model";
import { PipelineBar } from "./PipelineBar";
import { StageView } from "./StageViews";
import { StartRun } from "./StartRun";
import { EXAMPLE_RUN_ID } from "./stub";
import "./pipeline.css";

const LINKS = [
  { to: "/record", label: "Record" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/data", label: "Data" },
  { to: "/robots", label: "Robots" },
];

type Source = Parameters<typeof useRun>[1];

export default function PipelinePage({ fetchImpl, Source }: { fetchImpl?: Fetch; Source?: Source }) {
  const { run, stage } = useParams();
  return (
    <AppShell title="The pipeline" active={null} links={LINKS}>
      <div className="pipe-page">{run ? <RunView id={run} stage={stage} Source={Source} fetchImpl={fetchImpl} /> : <Runs fetchImpl={fetchImpl} />}</div>
    </AppShell>
  );
}

function Runs({ fetchImpl }: { fetchImpl?: Fetch }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const demos = (params.get("demos") ?? "").split(",").filter(Boolean);
  const runs = useAsync("runs", () => fetchRuns(fetchImpl));
  const missing = runs.state === "error" && /route|not found|unreachable|reach|fetch/i.test(runs.message);
  return (
    <>
      <p className="data-lede">
        After Record, SANT checks every demo with physics, repairs what failed, multiplies the good ones into verified variants, trains a policy
        on them, evaluates it on scenes it hasn't seen, and hands you the data. Follow each stage here, live, with its time left.
      </p>
      <StartRun demos={demos} fetchImpl={fetchImpl} onStarted={(id) => navigate(`/pipeline/${encodeURIComponent(id)}`)} />
      <section className="pipe-runs" aria-label="Runs">
        <h2 className="data-h3">Runs</h2>
        {runs.state === "loading" && <p className="data-note">Loading the runs…</p>}
        {missing && (
          <p className="data-note">
            The pipeline API isn't on this server yet. <Link to={`/pipeline/${EXAMPLE_RUN_ID}`}>Watch an example run</Link> to see the pages.
          </p>
        )}
        {runs.state === "error" && !missing && <p className="data-note data-note--error">The runs didn't load: {runs.message}</p>}
        {runs.state === "ok" && runs.value.length === 0 && (
          <p className="data-note">
            No runs yet. <Link to={`/pipeline/${EXAMPLE_RUN_ID}`}>Watch an example run</Link>.
          </p>
        )}
        {runs.state === "ok" && runs.value.length > 0 && (
          <ul className="pipe-runs__list">
            {runs.value.map((r) => (
              <li key={r.id}>
                <Link className="pipe-run" data-status={r.status} to={`/pipeline/${encodeURIComponent(r.id)}`}>
                  <span className="pipe-run__name">{r.name || r.id}</span>
                  <span className="pipe-run__meta">
                    {r.kind === "teacher" ? "teacher" : `${r.demos} demos`} · {r.status === "running" && r.stage ? `at ${r.stage}` : r.status}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RunView({ id, stage, Source, fetchImpl }: { id: string; stage?: string; Source?: Source; fetchImpl?: Fetch }) {
  const [params] = useSearchParams();
  // The example plays at 30x; ?speed= changes that (screenshots, demos).
  const speed = Math.max(1, Number(params.get("speed")) || 30);
  // Cancelling or resuming follows the run again from a fresh snapshot.
  const [nonce, setNonce] = useState(0);
  const [run, conn] = useRun(id, Source, speed, nonce);
  const bar = barOf(run);
  const stages = stagesFor(run.kind);
  const known = stages.some((s) => s.id === stage);
  const shown: StageId = known ? (stage as StageId) : (bar.current ?? stages[0].id);
  const example = id === EXAMPLE_RUN_ID;
  const search = example && params.get("speed") ? `?speed=${params.get("speed")}` : "";
  const ready = run.status === "done" && run.plan_s === null && shown !== "export";
  return (
    <>
      {example && <p className="pipe-example">An example run, played in your browser at {speed}× (not live): the pipeline API isn't on this server yet.</p>}
      <PipelineBar run={run} bar={bar} shown={shown} conn={conn} search={search} />
      <div className="pipe-run-status">
        {run.detail && <p className="data-note">{run.detail}</p>}
        {!example && run.id && <RunControls run={run} fetchImpl={fetchImpl} onChanged={() => setNonce((n) => n + 1)} />}
      </div>
      {ready && (
        <p className="pipe-ready">
          <Link to={`/pipeline/${encodeURIComponent(run.id)}/export${search}`}>Your data is ready: download it →</Link>
        </p>
      )}
      {/* a new stage mounts a new panel, which draws in (pipeline.css) */}
      <StageView key={shown} run={run} stage={shown} fetchImpl={fetchImpl} />
    </>
  );
}

/** Cancel a run that is going (after asking: it stops where it is, and can resume from there), or resume a stopped one. */
function RunControls({ run, fetchImpl, onChanged }: { run: RunState; fetchImpl?: Fetch; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const going = run.status === "running" || run.status === "queued";
  const stopped = (run.status === "cancelled" || run.status === "failed") && run.resumable;
  const act = (call: typeof cancelRun) => {
    setBusy(true);
    setError(null);
    call(run.id, fetchImpl).then(
      () => {
        setBusy(false);
        setAsking(false);
        onChanged();
      },
      (e: unknown) => {
        setBusy(false);
        setAsking(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };
  if (!going && !stopped && !error) return null;
  return (
    <div className="pipe-controls">
      {going && !asking && (
        <button type="button" className="data-btn data-btn--quiet" disabled={busy} onClick={() => setAsking(true)}>
          Cancel run
        </button>
      )}
      {going && asking && (
        <p className="pipe-controls__ask" role="group" aria-label="Cancel this run?">
          Cancel this run? It stops where it is, and can resume from there.
          <button type="button" className="data-btn" disabled={busy} onClick={() => act(cancelRun)}>
            {busy ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button type="button" className="data-btn data-btn--quiet" disabled={busy} onClick={() => setAsking(false)}>
            Keep it running
          </button>
        </p>
      )}
      {stopped && (
        <button type="button" className="data-btn" disabled={busy} onClick={() => act(resumeRun)}>
          {busy ? "Resuming…" : "Resume from where it stopped"}
        </button>
      )}
      {error && <p className="data-note data-note--error">{error}</p>}
    </div>
  );
}
