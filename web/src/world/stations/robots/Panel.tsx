// The robots catalog, beside the robot wall: one entry per robot, with only what the repo knows
// (catalog.ts). Hovering or focusing an entry lights its robot on the wall; a robot clicked on the wall
// brings its entry into view and focus. Back (or Escape, WorldRoot) returns to the room view.
import { Fragment, useEffect, useRef, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import { CATALOG, STATUS_LABEL, type CatalogRobot } from "./catalog";
import { robotsView } from "./hot";
import "./robots.css";

function Entry({ r, n, hot, buttonRef }: { r: CatalogRobot; n: number; hot: boolean; buttonRef: (el: HTMLButtonElement | null) => void }) {
  const on = () => robotsView.setHot(r.id);
  const off = () => robotsView.get().hot === r.id && robotsView.setHot(null);
  return (
    <li>
      <article className="world-robots__entry" aria-label={r.name} data-hot={hot} data-status={r.status}>
        <h3 className="world-robots__name">
          <button type="button" ref={buttonRef} onMouseEnter={on} onMouseLeave={off} onFocus={on} onBlur={off} onClick={on} aria-describedby={`world-robot-${r.id}-status`}>
            <span className="world-robots__n" aria-hidden="true">
              {String(n).padStart(2, "0")}
            </span>
            {r.name}
          </button>
        </h3>
        <p className="world-robots__status" id={`world-robot-${r.id}-status`} data-status={r.status}>
          {STATUS_LABEL[r.status]}
        </p>
        <dl className="world-robots__facts">
          {r.maker ? (
            <>
              <dt>Maker</dt>
              <dd>{r.maker}</dd>
            </>
          ) : null}
          <dt>Arm</dt>
          <dd>DoF {r.arm.dof}</dd>
          {r.arm.reach ? (
            <>
              <dt>Reach</dt>
              <dd>{r.arm.reach}</dd>
            </>
          ) : null}
          {r.gripper ? (
            <>
              <dt>Gripper</dt>
              <dd>{r.gripper}</dd>
            </>
          ) : null}
          <dt>In SANT</dt>
          <dd>{r.today}</dd>
          {r.result ? (
            <>
              <dt>In Isaac</dt>
              <dd>{r.result}</dd>
            </>
          ) : null}
        </dl>
        {r.limits ? (
          <details className="world-robots__src">
            <summary>Joint limits</summary>
            <dl className="world-robots__facts">
              {r.limits.map((l) => (
                <Fragment key={l.joint}>
                  <dt>{l.joint}</dt>
                  <dd>{l.range}</dd>
                </Fragment>
              ))}
            </dl>
          </details>
        ) : null}
        <details className="world-robots__src">
          <summary>Sources</summary>
          <ul>
            {r.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      </article>
    </li>
  );
}

export function Panel({ current, reduced }: { current: boolean; reduced: boolean }) {
  const { back } = useWorld();
  const view = useSyncExternalStore(robotsView.subscribe, robotsView.get);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  // Closing the view puts the wall back to plain.
  useEffect(() => {
    if (!current) robotsView.setHot(null);
  }, [current]);

  // A robot picked on the wall: its entry comes into view and takes the focus.
  useEffect(() => {
    if (!view.picked) return;
    const b = buttons.current[view.picked];
    if (!b) return;
    b.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    b.focus({ preventScroll: true });
  }, [view.picked, view.pickCount, reduced]);

  return (
    <aside className="world-robots" aria-labelledby="world-robots-title" aria-hidden={!current} data-on={current}>
      <header className="world-robots__head">
        <h2 id="world-robots-title" className="world-robots__title">
          The robots
        </h2>
        <button type="button" className="world-robots__back" onClick={() => back()}>
          ← Room
        </button>
      </header>
      <p className="world-robots__lede">
        The arms SANT has run, and the next ones. <b>Tested in Isaac</b>: SANT&apos;s pick-and-place ran on it in Isaac Lab. <b>Planned</b>: nothing has run on it yet.
      </p>
      <ol className="world-robots__list">
        {CATALOG.map((r, i) => (
          <Entry key={r.id} r={r} n={i + 1} hot={view.hot === r.id} buttonRef={(el) => (buttons.current[r.id] = el)} />
        ))}
      </ol>
      <p className="world-robots__note">
        On the wall, the Franka is built from its URDF&apos;s collision meshes; the others are simple stand-ins, not their real shape or size. Reach is
        shoulder to flange, the most over the joint limits, computed from each robot&apos;s URDF chain (brochures measure
        it differently). A field is left out when the sources don&apos;t record it (no payloads).
      </p>
    </aside>
  );
}
