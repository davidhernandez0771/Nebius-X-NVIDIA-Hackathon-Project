// Start a run: SANT on the demos just recorded (Record links here with ?demos=a,b) or on a tag of demos (preset,
// variants, repairer, where to stop), or the teacher recipe on a trained human run (T3's RL teacher, its gate, T6's
// distillation: rollouts, DAgger, preset). Either can be a dry run. The server's estimate comes before anything
// starts. The presets come from the server (GET /pipeline/config), which also says when it keeps the pipeline off
// (starting then answers 403 with the reason).
import { useEffect, useState } from "react";
import { useAsync } from "../data/hooks";
import { estimateRun, fetchConfig, fetchHumanRuns, startRun, type AnyRecipe, type Fetch, type Preset, type Recipe, type TeacherPreset, type TeacherRecipe } from "./api";
import { formatDuration, type RunKind } from "./model";

/** Until the server's config arrives (or when it has none). */
const PRESETS: Preset[] = [
  { id: "smoke", label: "Smoke (2k steps, 5 seeds)", steps: 2000, eval_n: 5 },
  { id: "standard", label: "Standard (30k steps, 40 seeds)", steps: 30000, eval_n: 40 },
  { id: "long", label: "Long (60k steps, 40 seeds)", steps: 60000, eval_n: 40 },
];
const TEACHER_PRESETS: TeacherPreset[] = [
  { id: "full", label: "Full (1,500 RL iterations, the 90% gate)", rl_iterations: 1500 },
  { id: "smoke", label: "Smoke (the smallest sizes, no gate threshold)", rl_iterations: 20 },
];

export function StartRun({ demos, fetchImpl, onStarted }: { demos: string[]; fetchImpl?: Fetch; onStarted: (id: string) => void }) {
  const [kind, setKind] = useState<RunKind>("demos");
  const [tag, setTag] = useState("");
  const [preset, setPreset] = useState<NonNullable<Recipe["preset"]>>("standard");
  const [variants, setVariants] = useState(10);
  const [repairer, setRepairer] = useState<NonNullable<Recipe["repairer"]>>("rules");
  const [stopAfter, setStopAfter] = useState<NonNullable<Recipe["stop_after"]>>("results");
  const [humanRun, setHumanRun] = useState("");
  const [teacherN, setTeacherN] = useState<TeacherRecipe["teacher_n"]>(300);
  const [dagger, setDagger] = useState(false);
  const [teacherPreset, setTeacherPreset] = useState<TeacherRecipe["preset"]>("full");
  const [dryRun, setDryRun] = useState(false);
  const [estimate, setEstimate] = useState<{ text: string; refused: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useAsync("pipeline-config", () => fetchConfig(fetchImpl));
  const presets = config.state === "ok" && config.value.presets.length ? config.value.presets : PRESETS;
  const teacherConfig = config.state === "ok" ? config.value.teacher : null;
  const teacherPresets = teacherConfig?.presets.length ? teacherConfig.presets : TEACHER_PRESETS;
  const rollouts = teacherConfig?.teacher_n.length ? teacherConfig.teacher_n : ([300, 600] as const);
  const off = config.state === "ok" && !config.value.enabled;
  const humans = useAsync(kind === "teacher" ? "human-runs" : null, () => fetchHumanRuns(fetchImpl));
  const humanRuns = humans.state === "ok" ? humans.value : [];

  useEffect(() => {
    if (!presets.some((p) => p.id === preset)) setPreset(presets[0].id);
  }, [presets, preset]);
  useEffect(() => {
    if (humanRuns.length && !humanRuns.some((r) => r.name === humanRun)) setHumanRun(humanRuns[0].name);
  }, [humanRuns, humanRun]);

  // The teacher recipe takes exactly its own fields (the server forbids any other).
  const full: AnyRecipe =
    kind === "teacher"
      ? { kind: "teacher", human_run: humanRun, teacher_n: teacherN, dagger, preset: teacherPreset }
      : { ...(demos.length ? { demos } : { tag }), preset, variants, repairer, stop_after: stopAfter };
  const recipe: AnyRecipe = dryRun ? { ...full, dry_run: true } : full;
  const ready = kind === "teacher" ? humanRun !== "" : demos.length > 0 || tag.trim().length > 0;
  // A dry run plans every stage and runs none (its own estimate is 0): ask what the full run would take.
  const key = JSON.stringify(full);

  useEffect(() => {
    if (!ready) return setEstimate(null);
    let live = true;
    estimateRun(full, fetchImpl).then(
      (e) => {
        if (!live) return;
        if (e.remaining_s === null) return setEstimate(null);
        const about = `about ${formatDuration(e.remaining_s)}`;
        const count = kind === "teacher" || demos.length ? "" : `${e.demos} demo${e.demos === 1 ? "" : "s"} · `;
        setEstimate({ text: dryRun ? `${count}A dry run plans it: the full run would take ${about}` : `${count}${about}, queued behind the GPU's other work`, refused: false });
      },
      // The server says why it can't (a tag that matches no demo, an unknown human run: 422).
      (e: unknown) => live && setEstimate({ text: e instanceof Error ? e.message : String(e), refused: true }),
    );
    return () => {
      live = false;
    };
    // the recipe is rebuilt every render; its JSON says when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, dryRun]);

  const start = () => {
    setBusy(true);
    setError(null);
    startRun(recipe, fetchImpl).then(onStarted, (e: unknown) => {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <section className="pipe-start" aria-label="Start a run">
      <h2 className="data-h3">Run SANT</h2>
      {off && (
        <p className="data-note">
          The pipeline is off on this server: you can follow runs, but starting one needs it turned on (SANT_PIPELINE=1).
        </p>
      )}
      <fieldset className="pipe-start__kind">
        <legend>Recipe</legend>
        <label>
          <input type="radio" name="pipe-kind" checked={kind === "demos"} onChange={() => setKind("demos")} /> From demos: check, repair, multiply, train
        </label>
        <label>
          <input type="radio" name="pipe-kind" checked={kind === "teacher"} onChange={() => setKind("teacher")} /> Teacher: RL teacher, gate, distill
        </label>
      </fieldset>
      {kind === "demos" ? (
        <div className="pipe-start__grid">
          {demos.length > 0 ? (
            <p className="pipe-start__demos">
              {demos.length} demo{demos.length === 1 ? "" : "s"} from your recording session
            </p>
          ) : (
            <label>
              Demos (a tag)
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="human_2026102*" />
            </label>
          )}
          <label>
            Preset
            <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Variants per demo
            <input type="number" min={1} max={99} value={variants} onChange={(e) => setVariants(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
          </label>
          <label>
            Repairer
            <select value={repairer} onChange={(e) => setRepairer(e.target.value as typeof repairer)}>
              <option value="rules">Rules</option>
              <option value="nemotron-edits">Nemotron edits</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label>
            Stop after
            <select value={stopAfter} onChange={(e) => setStopAfter(e.target.value as typeof stopAfter)}>
              <option value="grid">The data (no training)</option>
              <option value="train">Training</option>
              <option value="eval">Evaluation</option>
              <option value="results">Everything, with the report</option>
            </select>
          </label>
          <label className="pipe-start__check">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run (plan only, no GPU)
          </label>
        </div>
      ) : (
        <div className="pipe-start__grid">
          {humans.state === "ok" && humanRuns.length === 0 ? (
            <p className="data-note">No trained human run on this server yet: a teacher learns from one (a finished demos run).</p>
          ) : (
            <label>
              Human run
              <select value={humanRun} onChange={(e) => setHumanRun(e.target.value)}>
                {humanRuns.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.cell ? ` (${r.cell})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Preset
            <select value={teacherPreset} onChange={(e) => setTeacherPreset(e.target.value as typeof teacherPreset)}>
              {teacherPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Teacher rollouts
            <select value={teacherN} onChange={(e) => setTeacherN(Number(e.target.value) as typeof teacherN)}>
              {rollouts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="pipe-start__check">
            <input type="checkbox" checked={dagger} onChange={(e) => setDagger(e.target.checked)} /> DAgger round 1
          </label>
          <label className="pipe-start__check">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run (plan only, no GPU)
          </label>
        </div>
      )}
      {humans.state === "error" && kind === "teacher" && <p className="data-note data-note--error">The human runs didn't load: {humans.message}</p>}
      <div className="pipe-start__go">
        <button type="button" className="data-btn" disabled={!ready || busy} onClick={start}>
          {busy ? "Starting…" : "Run SANT"}
        </button>
        {estimate && <span className={`data-note${estimate.refused ? " data-note--error" : ""}`}>{estimate.text}</span>}
      </div>
      {error && <p className="data-note data-note--error">{error}</p>}
    </section>
  );
}
