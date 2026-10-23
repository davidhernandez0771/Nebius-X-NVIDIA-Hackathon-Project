// The way out of every place you can enter in the workshop (the shelf, the machine, the projection, the
// bench, the robot wall), top centre where the room view's hub bar sits: a real "← Back to room" button,
// where you are, and one line on what to do here, with Escape. A step inside a place (a robot's close-up)
// adds its own way back first. Shown only while the place is open, so there is one at a time.
import type { ReactNode } from "react";

export function StationBar({
  on,
  title,
  hint,
  back,
  step,
}: {
  on: boolean;
  title: string;
  /** What to do here, in a few words ("click a robot for a close-up"). */
  hint: string;
  back: () => void;
  /** A step back inside the place, before the room (the close-up's "All robots"). */
  step?: { label: string; onClick: () => void } | null;
}): ReactNode {
  if (!on) return null;
  return (
    <div className="world-stationbar world-u" role="group" aria-label={`${title}: the way out`}>
      {step ? (
        <button type="button" className="world-stationbar__btn world-stationbar__btn--step" onClick={step.onClick}>
          <span aria-hidden="true">← </span>
          {step.label}
        </button>
      ) : null}
      <button type="button" className="world-stationbar__btn" onClick={back}>
        <span aria-hidden="true">← </span>Back to room
      </button>
      <span className="world-stationbar__where">{title}</span>
      <span className="world-stationbar__hint">
        {hint} · <kbd>Esc</kbd> {step ? "steps back" : "goes back"}
      </span>
    </div>
  );
}
