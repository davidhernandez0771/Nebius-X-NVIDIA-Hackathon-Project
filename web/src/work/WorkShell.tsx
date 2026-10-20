// The frame around the work pages a cartridge opens (Record, Review, Dataset; Results is the
// Field Notes page at /site/results, which the nav links to), in the
// journey's look (docs/design/prototypes/site-journey.html): the brand top left, the four steps of the
// pipeline as a capsule, and the way back into the workshop. The hand cursor (webcam pointer) lives
// here, since these are the only pages that use it.
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import Icon from "../legacy/components/Icon";
import { useHandPointer } from "../hand/integration/useHandPointer";
import { HandCursorOverlay } from "../hand/overlay/HandCursorOverlay";
import { HandToggle } from "../hand/integration/HandToggle";
import { CalibrationPanel } from "../hand/overlay/CalibrationPanel";
import "./work.css";

/** The pipeline, in order: what the journey's cartridges stand for. */
export const STEPS = [
  { to: "/pm/record", n: "01", label: "Record" },
  { to: "/pm/review", n: "02", label: "Review" },
  { to: "/pm/dataset", n: "03", label: "Dataset" },
  { to: "/site/results", n: "04", label: "Results" },
] as const;

/** Back into the world: land in the workshop, at the spiral, not at the top of the journey. */
function backToWorkshop() {
  try {
    window.sessionStorage.setItem("world.return", "descent");
  } catch {
    /* blocked storage: the journey opens at the top */
  }
}

export function WorkShell() {
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  return (
    <div className="work">
      <header className="work-top">
        <Link to="/" className="work-brand work-u" onClick={backToWorkshop}>
          <b>S·A·N·T</b>
          <span>perfect, then multiply</span>
        </Link>
        <nav className="work-steps work-u" aria-label="Pipeline">
          {STEPS.map((s, i) => (
            <span key={s.to} className="work-steps__item">
              {i > 0 ? <i aria-hidden="true" /> : null}
              <NavLink to={s.to}>
                <em>{s.n}</em> {s.label}
              </NavLink>
            </span>
          ))}
        </nav>
        <Link to="/" className="work-back work-u" onClick={backToWorkshop}>
          ← Workshop
        </Link>
      </header>
      <main className="work-main">
        <Outlet />
      </main>
      <button
        type="button"
        className="hand-calibration-trigger"
        aria-label="Hand-control calibration"
        aria-expanded={calibrationOpen}
        onClick={() => setCalibrationOpen((open) => !open)}
      >
        <Icon name="settings" size={16} />
      </button>
      <CalibrationPanel api={hand} open={calibrationOpen} onClose={() => setCalibrationOpen(false)} />
      <HandToggle enabled={hand.enabled} status={hand.status} onEnable={hand.enable} onDisable={hand.disable} />
      <HandCursorOverlay api={hand} />
    </div>
  );
}
