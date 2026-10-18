import { forwardRef, type CSSProperties } from "react";
import { GlyphLoader } from "../../sant/components/GlyphLoader";
import { overallProgress, stageLabel } from "./report";
import { ReportCard } from "./ReportCard";
import type { Parts } from "./types";
import type { RunState } from "./useRun";

const N = 30;

/** Progress while the sim runs (stage, scenes ticking off), then the card; a failed run says why and keeps the last card. */
export const RunPanel = forwardRef<HTMLElement, { state: RunState; parts: Parts; recorded: boolean }>(function RunPanel({ state, parts, recorded }, ref) {
  if (state.phase === "idle" && !state.report) return null;
  const running = state.phase === "saving" || state.phase === "running";
  const progress = state.phase === "running" ? state.progress : null;
  const done = progress?.stage === "pick_place" ? progress.done : 0;

  return (
    <section className="byor-run" ref={ref} aria-labelledby="byor-run-title" tabIndex={-1}>
      <h2 id="byor-run-title" className="sant-sr-only">
        Report card run
      </h2>
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
              ? "Replaying the recorded run. A real run of 30 scenes takes about 7 minutes for the Franka."
              : "30 scenes in Isaac Sim, one at a time: about 7 minutes for the Franka. You can leave this page; the run keeps going."}
          </p>
        </div>
      )}
      {state.phase === "failed" && (
        <p className="byor-run__error" role="alert">
          The run didn't finish: {state.error}
        </p>
      )}
      {(running || state.phase === "failed") && state.report && <p className="byor-run__previous">Below: the last finished card.</p>}
      {state.report && <ReportCard report={state.report} parts={parts} />}
    </section>
  );
});
