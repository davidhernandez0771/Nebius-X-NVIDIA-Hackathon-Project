// Start SANT on the demos just recorded (Record links here with ?demos=a,b), or on a tag of demos: the recipe
// (preset, variants, repairer, where to stop, a dry run), the server's estimate before anything starts, then the
// run. The server keeps the pipeline off unless it is enabled (403 says so).
import { useEffect, useState } from "react";
import { estimateRun, startRun, type Fetch, type Recipe } from "./api";
import { formatDuration } from "./model";

const PRESETS: { id: NonNullable<Recipe["preset"]>; label: string }[] = [
  { id: "smoke", label: "Smoke (2k steps, 5 seeds)" },
  { id: "standard", label: "Standard (30k steps, 40 seeds)" },
  { id: "long", label: "Long (60k steps, 40 seeds)" },
];

export function StartRun({ demos, fetchImpl, onStarted }: { demos: string[]; fetchImpl?: Fetch; onStarted: (id: string) => void }) {
  const [tag, setTag] = useState("");
  const [preset, setPreset] = useState<NonNullable<Recipe["preset"]>>("standard");
  const [variants, setVariants] = useState(10);
  const [repairer, setRepairer] = useState<NonNullable<Recipe["repairer"]>>("rules");
  const [stopAfter, setStopAfter] = useState<NonNullable<Recipe["stop_after"]>>("results");
  const [dryRun, setDryRun] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recipe: Recipe = {
    ...(demos.length ? { demos } : { tag }),
    preset,
    variants,
    repairer,
    stop_after: stopAfter,
    ...(dryRun ? { dry_run: true } : {}),
  };
  const ready = demos.length > 0 || tag.trim().length > 0;
  const key = JSON.stringify(recipe);

  useEffect(() => {
    if (!ready) return setEstimate(null);
    let live = true;
    estimateRun(recipe, fetchImpl).then(
      (e) => live && setEstimate(e.remaining_s !== null ? `about ${formatDuration(e.remaining_s)}` : null),
      () => live && setEstimate(null),
    );
    return () => {
      live = false;
    };
    // the recipe is rebuilt every render; its JSON says when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

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
      <div className="pipe-start__grid">
        {demos.length > 0 ? (
          <p className="pipe-start__demos">
            {demos.length} demo{demos.length === 1 ? "" : "s"} from your recording session
          </p>
        ) : (
          <label>
            Demos (a tag, e.g. human_2026102*)
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="human_2026102*" />
          </label>
        )}
        <label>
          Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
            {PRESETS.map((p) => (
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
        {estimate && <span className="data-note">{estimate}, queued behind the GPU's other work</span>}
      </div>
      {error && <p className="data-note data-note--error">{error}</p>}
    </section>
  );
}
