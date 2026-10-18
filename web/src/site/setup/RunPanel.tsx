import type { CSSProperties } from "react";
import { GlyphLoader } from "../../sant/components/GlyphLoader";
import { overallProgress, runBlocked, stageLabel } from "./report";
import { ReportCard } from "./ReportCard";
import type { Parts } from "./types";
import type { RunState } from "./useRun";

const N = 30;

/** The report view: progress while the sim runs (stage, scenes ticking off), then the card; a failed run says why. */
export function RunPanel({ state, parts, recorded, onSources }: { state: RunState; parts: Parts; recorded: boolean; onSources?: () => void }) {
  const running = state.phase === "saving" || state.phase === "running";
  const progress = state.phase === "running" ? state.progress : null;
  const done = progress?.stage === "pick_place" ? progress.done : 0;

  return (
    <section className="byor-run" aria-label="Report card run">
      {running && (
        <div className="byor-progress" aria-live="polite">
          <GlyphLoader
            label={state.phase === "saving" ? "Saving the roles" : progress ? stageLabel(progress) : "Waiting for the simulator"}
            progress={state.phase === "saving" ? undefined : overallProgress(progress)}
          />
          <ol className="byor-strip byor-strip--pending" aria-hidden="true">
            {Array.from({ length: progress?.total && progress.stage === "pick_place" ? progress.total : N }, (_, i) => (
              <li key={i} className="byor-strip__cell" data-done={i < done} style={{ "--i": i } as CSSProperties} />
            ))}
          </ol>
          <p className="byor-progress__note">
            {recorded
              ? "Sample data: replaying T2's recorded run. A real run of 30 scenes takes about 7 minutes for the Franka."
              : "30 scenes in Isaac Sim, one at a time: about 7 minutes for the Franka. You can leave this page; the run keeps going."}
          </p>
        </div>
      )}
      {state.phase === "failed" && (
        <p className="byor-run__error" role="alert">
          {runBlocked(state.note) ?? "The run didn't finish."} <span className="byor-run__detail">{state.error}</span>
        </p>
      )}
      {state.report && !running ? (
        <>
          {state.phase === "failed" && <p className="byor-run__previous">Below: the last finished card.</p>}
          <ReportCard report={state.report} parts={parts} onSources={onSources} />
        </>
      ) : (
        !running &&
        state.phase !== "failed" && <p className="byor-run__empty">Run the report card to see how this robot does on the 30 scenes.</p>
      )}
    </section>
  );
}
