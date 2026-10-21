// One page per stage of a run (PipelinePage): what the stage is doing, how far it has got and on what basis its time
// is estimated, and what it has produced so far. The verdict badges, the repair wording and the before/after table
// are /data's (site/data), so the two read the same.
import type { CSSProperties } from "react";
import { useMotion } from "../../sant/motion/MotionProvider";
import { FootageView } from "../data/FootageView";
import { useAsync, useClock } from "../data/hooks";
import { VerdictBadge } from "../data/Pane";
import { repairText, verdictOf, whatChanged, demoName, type RepairStage, type Verification } from "../data/model";
import { downloadUrl, fetchArtifacts, fetchRunFootage, type Fetch } from "./api";
import {
  evalCells, evalScore, formatDuration, lossHead, lossPath, stageMeta, stageOf, stagesFor, type Metrics, type RepairRow, type RunState, type Stage, type StageId, type VariantRow,
} from "./model";

const nf = new Intl.NumberFormat("en-US");

function StageHead({ stage, run }: { stage: Stage; run: RunState }) {
  const meta = stageMeta(stage.id);
  // Train counts its steps itself, per cell (TrainView); its items add up every cell.
  const items = stage.id === "train" ? null : stage.items;
  const order = stagesFor(run.kind);
  const at = String(order.findIndex((s) => s.id === stage.id) + 1).padStart(2, "0");
  return (
    <header className="pipe-head">
      <p className="pipe-eyebrow">
        Stage {at} of {String(order.length).padStart(2, "0")}
      </p>
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
        {stage.status === "skipped" &&
          (run.plan_s !== null && stage.eta_s !== null ? `Skipped (a dry run): about ${formatDuration(stage.eta_s)} when it runs.` : "Skipped for this run.")}
      </p>
      {/* Train's summary line says the step already */}
      {stage.status === "running" && stage.detail && stage.id !== "train" && <p className="data-note">{stage.detail}</p>}
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
  const d = lossPath(t.loss, W, H);
  const head = lossHead(t.loss, W, H);
  return (
    <>
      <p className="data-summary">
        {nf.format(t.step)} of {nf.format(t.steps)} steps
        {t.cell ? ` · ${t.cell}` : ""}
      </p>
      <figure className="pipe-loss">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Training loss over steps (log scale)">
          {/* a faint grid, the trace's glow (a wide soft stroke, no filter) under the line, and its head */}
          {[1, 2, 3].map((i) => (
            <line key={i} className="pipe-loss__grid" x1="0" x2={W} y1={(H * i) / 4} y2={(H * i) / 4} />
          ))}
          <path className="pipe-loss__glow" d={d} />
          <path className="pipe-loss__line" d={d} />
          {head && <circle className="pipe-loss__head" cx={head[0]} cy={head[1]} r="3.5" />}
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
  const cells = evalCells(run);
  return (
    <>
      {cells.length > 1 ? (
        // Both cells run the same seeds: each is scored on its own.
        cells.map((c) => (
          <p key={c.cell} className="data-summary">
            {c.label}: {c.k} of {c.run} seeds succeeded{c.planned ? ` (${c.planned} planned)` : ""}
          </p>
        ))
      ) : (
        <p className="data-summary">
          {s.k} of {s.run} seeds succeeded{s.planned ? ` (${s.planned} planned)` : ""}
        </p>
      )}
      <SeedTiles run={run} />
    </>
  );
}

/** One tile per seed run, green or not, its reasons in the title (with its cell's label when there are two). */
function SeedTiles({ run }: { run: RunState }) {
  const cells = evalCells(run);
  return (
    <ul className="pipe-seeds" aria-label="Seeds">
      {run.evaluate.seeds.map((x) => (
        <li
          key={`${x.cell ?? ""}:${x.seed}`}
          className="pipe-seed"
          data-ok={x.success}
          data-cell={x.cell ?? undefined}
          title={`${cells.length > 1 ? `${cells.find((c) => c.cell === (x.cell ?? ""))?.label}, ` : ""}seed ${x.seed}: ${x.success ? "succeeded" : x.reasons.join(", ") || "failed"}`}
        >
          {x.seed}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------ the teacher recipe's stages

const pct = (x: number) => `${Math.round(x * 100)}%`;

function TeacherView({ run }: { run: RunState }) {
  const t = run.teacher;
  if (!t) return <p className="data-note">No teacher yet.</p>;
  return (
    <>
      <p className="data-summary">
        {nf.format(t.iterations)} RL iterations, from the human run {t.human_run}
        {t.smoke ? " (smoke test)" : ""}
      </p>
      <ul className="data-list">
        <li>
          {nf.format(t.iteration)} of {nf.format(t.iterations)} iterations done
        </li>
        <li>Then {t.teacher_n} teacher rollouts for the student</li>
        <li>{t.dagger ? "Then a DAgger round" : "No DAgger round"}</li>
      </ul>
    </>
  );
}

function GateView({ run }: { run: RunState }) {
  const g = run.teacher?.gate;
  const gate = g?.min !== null && g?.min !== undefined ? `the gate is ${pct(g.min)}` : "no gate threshold (smoke test)";
  return (
    <>
      <p className="data-summary">
        {g && g.n
          ? `${g.successes ?? 0} of ${g.n} replays verified (${pct((g.successes ?? 0) / g.n)}); ${gate}${g.passed === null ? "" : g.passed ? ": passed" : ": failed"}`
          : `Not scored yet; ${gate}.`}
      </p>
      {g && g.n ? (
        // The sentence above says it; this draws it: the score, the gate's line.
        <div
          className="pipe-gate"
          aria-hidden="true"
          data-passed={g.passed === null ? undefined : String(g.passed)}
          style={{ "--pipe-score": ((g.successes ?? 0) / g.n).toFixed(4), "--pipe-min": g.min ?? 0 } as CSSProperties}
        >
          <i className="pipe-gate__fill" />
          {g.min !== null && <i className="pipe-gate__min" />}
        </div>
      ) : null}
      {g?.seeds && (
        <p className="data-note">
          Seeds {g.seeds[0]}–{g.seeds[1]}, which no demo saw. The teacher runs each, then SANT's physics replays what it did.
        </p>
      )}
      <SeedTiles run={run} />
    </>
  );
}

/** A round's phases in order, drawn as a short track (the bar's conduit in small). */
const PHASES = [
  ["rollouts", "Rollouts"],
  ["grid", "Mix"],
  ["train", "Train"],
  ["select", "Pick"],
] as const;

function PhaseTrack({ round, phase }: { round: number; phase: string }) {
  const at = phase === "done" || phase === "stopped" ? PHASES.length : PHASES.findIndex(([id]) => id === phase);
  return (
    <ol className="pipe-phases" aria-label={`Round ${round}'s phases`}>
      {PHASES.map(([id, label], i) => (
        <li key={id} data-state={i < at ? "done" : i === at ? "now" : "next"} aria-current={i === at ? "step" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

const PHASE: Record<string, string> = {
  rollouts: "collecting rollouts",
  grid: "mixing the data",
  train: "training the student",
  select: "choosing the best checkpoint",
  done: "done",
  stopped: "stopped by DAgger's stop rule",
};

/** A distillation round (0: from the teacher's rollouts; 1: DAgger): its phase, rollouts, the student's curve, the pick. */
function RoundView({ run, round }: { run: RunState; round: number }) {
  const t = run.teacher;
  if (round === 1 && t && !t.dagger) return <p className="data-note">Not asked for this run.</p>;
  const rd = t?.rounds.find((r) => r.round === round);
  if (!rd) return <p className="data-note">Not started.</p>;
  return (
    <>
      <p className="data-summary">
        Round {round}: {PHASE[rd.phase] ?? rd.phase}
      </p>
      <PhaseTrack round={round} phase={rd.phase} />
      <ul className="data-list">
        <li>
          {rd.rollouts.done} of {rd.rollouts.total} {round === 0 ? "teacher" : "DAgger"} rollouts ({rd.rollouts.successes} succeeded)
        </li>
        {rd.chosen_step !== null && <li>Chose the checkpoint at step {nf.format(rd.chosen_step)}</li>}
      </ul>
      {run.train.cell === `distill_r${round}` && <TrainView run={run} />}
    </>
  );
}

const DistillView = ({ run }: { run: RunState }) => <RoundView run={run} round={0} />;
const DaggerView = ({ run }: { run: RunState }) => <RoundView run={run} round={1} />;

const MB = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const KIND: Record<string, string> = { dataset: "The dataset", robota: "The Robota export", report: "The report", checkpoint: "A checkpoint", other: "A file" };

/** What a file is, from its name where T5's export names it (dataset_<cell>.zip, results.json), else its kind. */
function kindOf(a: RunState["artifacts"][number]): string {
  const cell = /^dataset_(.+)\.zip$/.exec(a.name)?.[1];
  if (a.name === "student_checkpoint.zip") return "The student's checkpoint";
  if (cell) return `The dataset: ${/^raw_/.test(cell) ? "raw demos" : /^perfected_multiply_/.test(cell) ? "SANT (repaired + multiplied)" : cell}`;
  if (a.name === "results.json") return "The results";
  return KIND[a.kind];
}

function ExportView({ run, fetchImpl }: { run: RunState; fetchImpl?: Fetch }) {
  // Once the run is over, its artifact list is the word on what there is to download.
  const listed = useAsync(run.id && run.status === "done" && run.plan_s === null ? `artifacts:${run.id}` : null, () => fetchArtifacts(run.id, fetchImpl));
  const files = listed.state === "ok" && listed.value.length ? listed.value : run.artifacts;
  if (files.length === 0) return <p className="data-note">Nothing to download yet: the files appear here when the run gets to Export.</p>;
  return (
    <ul className="pipe-files" aria-label="Downloads">
      {files.map((a) => (
        <li key={a.name} className="pipe-file" data-kind={a.kind}>
          <span className="pipe-file__kind">{kindOf(a)}</span>
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
  teacher: TeacherView,
  gate: GateView,
  distill: DistillView,
  dagger: DaggerView,
};

export function StageView({ run, stage, fetchImpl }: { run: RunState; stage: StageId; fetchImpl?: Fetch }) {
  const View = VIEWS[stage];
  return (
    <section className="pipe-stage-page" data-stage={stage} aria-label={stageMeta(stage).label}>
      <StageHead stage={stageOf(run, stage)} run={run} />
      {run.plan_s !== null ? <p className="data-note">A dry run plans the stages and runs none of them.</p> : <View run={run} fetchImpl={fetchImpl} />}
    </section>
  );
}
