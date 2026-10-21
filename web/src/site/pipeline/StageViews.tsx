// One page per stage of a run (PipelinePage): what the stage is doing, how far it has got and on what basis its time
// is estimated, and what it has produced so far. The verdict badges, the repair wording and the before/after table
// are /data's (site/data), so the two read the same.
import { useMotion } from "../../sant/motion/MotionProvider";
import { FootageView } from "../data/FootageView";
import { useAsync, useClock } from "../data/hooks";
import { VerdictBadge } from "../data/Pane";
import { repairText, verdictOf, whatChanged, demoName, type RepairStage, type Verification } from "../data/model";
import { downloadUrl, fetchRunFootage, type Fetch } from "./api";
import {
  PIPELINE_STAGES, evalScore, formatDuration, lossPath, stageOf, type Metrics, type RepairRow, type RunState, type Stage, type StageId, type VariantRow,
} from "./model";

const nf = new Intl.NumberFormat("en-US");

function StageHead({ stage, run }: { stage: Stage; run: RunState }) {
  const meta = PIPELINE_STAGES.find((s) => s.id === stage.id)!;
  const items = stage.items;
  return (
    <header className="pipe-head">
      <h2 className="data-h2">{meta.label}</h2>
      <p className="data-lede">{meta.blurb}</p>
      <p className="pipe-head__state" data-status={stage.status}>
        {stage.status === "running" && (
          <>
            Running{items ? `: ${nf.format(items.done)} of ${nf.format(items.total)} ${items.unit}${items.total === 1 ? "" : "s"}` : ` (${Math.round(stage.progress * 100)}%)`}
            {stage.eta_s !== null && ` · about ${formatDuration(stage.eta_s)} left`}
          </>
        )}
        {stage.status === "pending" && (run.gpu.state === "queued" ? "Waiting for the GPU." : `Not started${stage.eta_s !== null ? ` (about ${formatDuration(stage.eta_s)} when it runs)` : ""}.`)}
        {stage.status === "done" && `Done${stage.detail ? `: ${stage.detail}` : ""}.`}
        {stage.status === "failed" && `Stopped${stage.detail ? `: ${stage.detail}` : ""}.`}
        {stage.status === "skipped" && "Skipped for this run."}
      </p>
      {stage.status === "running" && stage.detail && <p className="data-note">{stage.detail}</p>}
      {stage.eta_basis && <p className="pipe-head__basis">Estimate: {stage.eta_basis}</p>}
    </header>
  );
}

const name = (id: string) => demoName(id);

function CheckView({ run }: { run: RunState }) {
  if (run.check.length === 0) return <p className="data-note">No verdicts yet.</p>;
  return (
    <ul className="pipe-rows" aria-label="Verdicts">
      {run.check.map((c) => (
        <li key={c.demo} className="pipe-row">
          <span className="pipe-row__name">{name(c.demo)}</span>
          <VerdictBadge verdict={verdictOf(c)} />
          <span className="pipe-row__meta">
            {c.duration !== undefined && `${c.duration.toFixed(1)} s`}
            {c.max_contact_force !== undefined && ` · peak contact ${c.max_contact_force.toFixed(0)} N`}
          </span>
        </li>
      ))}
    </ul>
  );
}

const asVerification = (m: Metrics | null): Verification | null =>
  m && { success: true, reasons: [], duration: m.duration ?? null, pathLength: m.path_length ?? null, maxContactForce: m.max_contact_force ?? null, settleTime: m.settle_time ?? null };

const asStage = (r: RepairRow): RepairStage => ({
  status: r.status,
  decision: null,
  diagnosisSource: null,
  outputId: r.output_id,
  repairs: r.repairs,
  issues: [],
  before: asVerification(r.before),
  after: asVerification(r.after),
});

function RepairView({ run }: { run: RunState }) {
  if (run.repair.length === 0) return <p className="data-note">No repairs yet.</p>;
  return (
    <div className="pipe-repairs">
      {run.repair.map((r) => {
        const rows = whatChanged(asStage(r));
        return (
          <section key={r.demo} className="pipe-repair">
            <h3 className="data-h3">
              {name(r.demo)} · {r.status}
            </h3>
            <ul className="data-list">
              {r.repairs.length ? r.repairs.map((x, i) => <li key={i}>{repairText(x)}</li>) : <li>Nothing to change.</li>}
            </ul>
            {rows.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.label}>
                      <th scope="row">{x.label}</th>
                      <td>{x.before}</td>
                      <td>{x.after}</td>
                      <td>{x.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** One variant: the simulator's footage of it (when the run kept frames), and its physics verdict. */
function VariantCard({ run, v, t, fetchImpl }: { run: RunState; v: VariantRow; t: number; fetchImpl?: Fetch }) {
  const footage = useAsync(v.frames > 0 ? `${run.id}:${v.id}` : null, () => fetchRunFootage(run.id, v.id, fetchImpl));
  return (
    <li className="data-variant data-variant--live">
      <FootageView footage={footage.state === "ok" ? footage.value : null} t={t} label={`Isaac Sim front camera, variant ${v.seed ?? v.id}`} />
      <span className="data-variant__name">
        {name(v.source)} · seed {v.seed ?? "?"}
      </span>
      <VerdictBadge verdict={verdictOf(v)} />
    </li>
  );
}

function MultiplyView({ run, fetchImpl }: { run: RunState; fetchImpl?: Fetch }) {
  const ok = run.variants.filter((v) => v.success).length;
  const { reduced } = useMotion();
  // Every variant's footage loops on one clock (a variant runs about 8 s), as /data's live view.
  const [t] = useClock(9, !reduced, 20);
  return (
    <>
      <p className="data-summary">
        {ok} of {run.variants.length} verified
      </p>
      <ul className="data-variants__grid" aria-label="Variants">
        {run.variants.map((v) => (
          <VariantCard key={v.id} run={run} v={v} t={t} fetchImpl={fetchImpl} />
        ))}
      </ul>
    </>
  );
}

function TrainView({ run }: { run: RunState }) {
  const t = run.train;
  const W = 640, H = 200;
  return (
    <>
      <p className="data-summary">
        {nf.format(t.step)} of {nf.format(t.steps)} steps
        {t.eta_s !== null && t.step < t.steps ? ` · ${formatDuration(t.eta_s)} left` : ""}
        {t.cell ? ` · ${t.cell}` : ""}
      </p>
      <figure className="pipe-loss">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Training loss over steps (log scale)">
          <path className="pipe-loss__line" d={lossPath(t.loss, W, H)} />
        </svg>
        <figcaption>
          Loss {t.loss.length ? `${t.loss[t.loss.length - 1][1].toFixed(3)} now, from ${t.loss[0][1].toFixed(3)}` : "not yet"} (log scale)
        </figcaption>
      </figure>
      {t.checkpoints.length > 0 && (
        <>
          <h3 className="data-h3">Checkpoints</h3>
          <ul className="data-list">
            {t.checkpoints.map((c) => (
              <li key={c.step}>
                <span>{c.name}</span> · step {nf.format(c.step)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function EvaluateView({ run }: { run: RunState }) {
  const s = evalScore(run);
  return (
    <>
      <p className="data-summary">
        {s.k} of {s.run} seeds succeeded{s.planned ? ` (${s.planned} planned)` : ""}
      </p>
      <ul className="pipe-seeds" aria-label="Seeds">
        {run.evaluate.seeds.map((x) => (
          <li
            key={`${x.cell ?? ""}${x.seed}`}
            className="pipe-seed"
            data-ok={x.success}
            title={`seed ${x.seed}: ${x.success ? "succeeded" : x.reasons.join(", ") || "failed"}`}
          >
            {x.seed}
          </li>
        ))}
      </ul>
    </>
  );
}

const MB = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const KIND: Record<string, string> = { dataset: "The dataset", robota: "The Robota export", report: "The report", checkpoint: "A checkpoint", other: "A file" };

function ExportView({ run }: { run: RunState }) {
  if (run.artifacts.length === 0) return <p className="data-note">Nothing to download yet: the files appear here when the run gets to Export.</p>;
  return (
    <ul className="pipe-files" aria-label="Downloads">
      {run.artifacts.map((a) => (
        <li key={a.name} className="pipe-file">
          <span className="pipe-file__kind">{KIND[a.kind]}</span>
          {a.url ? (
            <a className="pipe-file__link" href={downloadUrl(a.url)} download={a.name}>
              {a.name}
            </a>
          ) : (
            <span className="pipe-file__link">{a.name}</span>
          )}
          <span className="pipe-file__size">{MB(a.bytes)}</span>
          {a.note && <span className="pipe-file__note">{a.note}</span>}
        </li>
      ))}
    </ul>
  );
}

const VIEWS: Record<StageId, (p: { run: RunState; fetchImpl?: Fetch }) => JSX.Element> = {
  check: CheckView,
  repair: RepairView,
  multiply: MultiplyView,
  train: TrainView,
  evaluate: EvaluateView,
  export: ExportView,
};

export function StageView({ run, stage, fetchImpl }: { run: RunState; stage: StageId; fetchImpl?: Fetch }) {
  const View = VIEWS[stage];
  return (
    <section className="pipe-stage-page" aria-label={PIPELINE_STAGES.find((s) => s.id === stage)!.label}>
      <StageHead stage={stageOf(run, stage)} run={run} />
      <View run={run} fetchImpl={fetchImpl} />
    </section>
  );
}
