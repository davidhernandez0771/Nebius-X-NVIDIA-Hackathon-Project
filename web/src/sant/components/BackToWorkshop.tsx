// The 2D pages' one way back into the world: "← Back to workshop", first after the SANT mark top left (where the
// world's places put their "← Back to room", world/ui/StationBar), in the same holo look: mono capitals, a squared
// teal box. It lands where the visitor left the workshop (the machine, saved by the projection's hand-off,
// world/core/handoff.ts), else in the workshop's room view; never at the top of the story. A real link (a new tab
// works too). No Escape here: on these pages Escape belongs to the page (Record's keys, dialogs, a picked robot).
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { keepReturn } from "../../world/core/handoff";
import "./back.css";

function session(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function BackToWorkshop({ className, onClick }: { className?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link
      to="/"
      className={className ? `sant-back ${className}` : "sant-back"}
      title="Back to the workshop, where you left it"
      onClick={(e) => {
        keepReturn(session(), "workshop");
        onClick?.(e);
      }}
    >
      <span aria-hidden="true">←</span>
      <span>Back to workshop</span>
    </Link>
  );
}
