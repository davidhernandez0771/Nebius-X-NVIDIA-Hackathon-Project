// The pipeline (/pipeline): every SANT stage after Record as a page you can follow live, with its time left, ending
// in the download of your data. /pipeline lists the runs and starts one (on the demos just recorded: ?demos=a,b);
// /pipeline/{run}/{stage} follows a run, the pipeline bar on top (where it is, time spent and left, the GPU queue).
// Until the pipeline API is on the server (pm/pipeline-api) the list says so and offers the example run (stub.ts).
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import { useAsync } from "../data/hooks";
import "../data/data.css";
import { fetchRuns, type Fetch } from "./api";
import { useRun } from "./hooks";
import { PIPELINE_STAGES, barOf, type StageId } from "./model";
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
                <Link className="pipe-run" to={`/pipeline/${encodeURIComponent(r.id)}`}>
                  <span className="pipe-run__name">{r.name || r.id}</span>
                  <span className="pipe-run__meta">
                    {r.demos} demos · {r.status === "running" ? `at ${r.stage}` : r.status}
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
  const [run, conn] = useRun(id, Source, speed);
  const bar = barOf(run);
  const known = PIPELINE_STAGES.some((s) => s.id === stage);
  const shown: StageId = known ? (stage as StageId) : (bar.current ?? "check");
  const example = id === EXAMPLE_RUN_ID;
  return (
    <>
      {example && <p className="pipe-example">An example run, played in your browser at {speed}× (not live): the pipeline API isn't on this server yet.</p>}
      <PipelineBar run={run} bar={bar} shown={shown} conn={conn} />
      {run.detail && <p className="data-note">{run.detail}</p>}
      <StageView run={run} stage={shown} fetchImpl={fetchImpl} />
    </>
  );
}
