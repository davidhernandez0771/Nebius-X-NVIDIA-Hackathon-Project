// Start SANT on the demos just recorded (Record links here with ?demos=a,b), or on a tag of demos: the recipe
// (preset, variants, repairer, where to stop, a dry run), the server's estimate before anything starts, then the
// run. The presets come from the server (GET /pipeline/config), which also says when it keeps the pipeline off
// (starting then answers 403 with the reason).
import { useEffect, useState } from "react";
import { useAsync } from "../data/hooks";
import { estimateRun, fetchConfig, startRun, type Fetch, type Preset, type Recipe } from "./api";
import { formatDuration } from "./model";

/** Until the server's config arrives (or when it has none). */
const PRESETS: Preset[] = [
  { id: "smoke", label: "Smoke (2k steps, 5 seeds)", steps: 2000, eval_n: 5 },
  { id: "standard", label: "Standard (30k steps, 40 seeds)", steps: 30000, eval_n: 40 },
  { id: "long", label: "Long (60k steps, 40 seeds)", steps: 60000, eval_n: 40 },
];

export function StartRun({ demos, fetchImpl, onStarted }: { demos: string[]; fetchImpl?: Fetch; onStarted: (id: string) => void }) {
  const [tag, setTag] = useState("");
  const [preset, setPreset] = useState<NonNullable<Recipe["preset"]>>("standard");
  const [variants, setVariants] = useState(10);
  const [repairer, setRepairer] = useState<NonNullable<Recipe["repairer"]>>("rules");
  const [stopAfter, setStopAfter] = useState<NonNullable<Recipe["stop_after"]>>("results");
  const [dryRun, setDryRun] = useState(false);
  const [estimate, setEstimate] = useState<{ text: string; refused: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useAsync("pipeline-config", () => fetchConfig(fetchImpl));
  const presets = config.state === "ok" && config.value.presets.length ? config.value.presets : PRESETS;
  const off = config.state === "ok" && !config.value.enabled;

  useEffect(() => {
    if (!presets.some((p) => p.id === preset)) setPreset(presets[0].id);
  }, [presets, preset]);

  const recipe: Recipe = {
    ...(demos.length ? { demos } : { tag }),
    preset,
    variants,
    repairer,
    stop_after: stopAfter,
    ...(dryRun ? { dry_run: true } : {}),
  };
  const ready = demos.length > 0 || tag.trim().length > 0;
  // A dry run plans every stage and runs none (its own estimate is 0): ask what the full run would take.
  const { dry_run: _dry, ...full } = recipe;
  const key = JSON.stringify(full);

  useEffect(() => {
    if (!ready) return setEstimate(null);
    let live = true;
    estimateRun(full, fetchImpl).then(
      (e) => {
        if (!live) return;
        if (e.remaining_s === null) return setEstimate(null);
        const about = `about ${formatDuration(e.remaining_s)}`;
        const count = demos.length ? "" : `${e.demos} demo${e.demos === 1 ? "" : "s"} · `;
        setEstimate({ text: dryRun ? `${count}A dry run plans it: the full run would take ${about}` : `${count}${about}, queued behind the GPU's other work`, refused: false });
      },
      // The server says why it can't (a tag that matches no demo: 422).
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
