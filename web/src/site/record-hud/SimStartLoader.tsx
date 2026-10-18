import type { CSSProperties } from "react";
import { formatClock } from "./hudModel";
import "./record-hud.css";

/**
 * The quiet loader for "starting simulator": one line of text with the time so far, a 1 px rule
 * that fills with `progress` (or a short segment drifting along it when the length is unknown),
 * and the start-up steps in order. No glyph noise, no brackets; with reduced motion the segment
 * stands still.
 */
export function SimStartLoader({
  label = "starting simulator",
  steps,
  current,
  elapsedMs,
  progress,
}: {
  label?: string;
  steps: string[];
  current: number;
  elapsedMs?: number;
  progress?: number;
}) {
  const p = progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  const step = steps[Math.min(current, steps.length - 1)];
  return (
    <div className="rh-loader" role="status" aria-label={`${label}: ${step}`}>
      <p className="rh-loader__row">
        <span>{label}</span>
        {elapsedMs !== undefined && <span className="rh-loader__time">{formatClock(elapsedMs)}</span>}
      </p>
      <div className="rh-loader__rule" data-indeterminate={p === undefined || undefined} aria-hidden="true">
        <span style={p === undefined ? undefined : ({ width: `${p * 100}%` } as CSSProperties)} />
      </div>
      <ol className="rh-loader__steps">
        {steps.map((s, i) => (
          <li key={s} data-state={i < current ? "done" : i === current ? "now" : "next"}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
