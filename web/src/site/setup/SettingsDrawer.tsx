import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./client";
import { metres } from "./fmt";
import { CloseIcon } from "./icons";
import type { ReportCard } from "./types";
import type { Robot } from "./SetupPage";

type Tab = "robot" | "sources";

/**
 * The rarely used settings, in a slide-over: where the base sits, the robot's derived facts and what data the page
 * is on ("Robot"), and where every number on the report card comes from ("Sources"). A native modal <dialog>: focus
 * stays inside, Escape and the backdrop close it. Each tab fits a 720 px window, so nothing in it scrolls.
 */
export function SettingsDrawer({
  open,
  onClose,
  robot,
  mount,
  onMount,
  recorded,
  report,
  tab: initialTab = "robot",
}: {
  open: boolean;
  onClose: () => void;
  robot: Robot;
  mount: [number, number, number];
  onMount: (m: [number, number, number]) => void;
  recorded: boolean;
  report: ReportCard | null;
  tab?: Tab;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== "function") return;
    if (open && !d.open) {
      setTab(initialTab === "sources" && !report ? "robot" : initialTab);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initialTab, report]);

  const d = robot.parts.derived;
  const { upload } = robot;

  return (
    <dialog
      ref={ref}
      className="byor-drawer"
      data-tab={tab}
      aria-labelledby="byor-drawer-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="byor-drawer__body">
        <header className="byor-drawer__head">
          <h2 id="byor-drawer-title" className="byor-drawer__title">
            Settings
          </h2>
          <button type="button" className="byor-drawer__close" aria-label="Close settings" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="byor-views" role="group" aria-label="Settings section">
          <button type="button" className="byor-views__btn" aria-pressed={tab === "robot"} onClick={() => setTab("robot")}>
            Robot
          </button>
          <button type="button" className="byor-views__btn" aria-pressed={tab === "sources"} disabled={!report} onClick={() => setTab("sources")}>
            Report card sources
          </button>
        </div>

        {tab === "robot" ? (
          <>
            <section className="byor-drawer__section" aria-labelledby="byor-mount-title">
              <h3 id="byor-mount-title" className="byor-drawer__sub">
                Where the base sits
              </h3>
              <div className="byor-mount" role="group" aria-label="Base position in metres">
                {(["x", "y", "z"] as const).map((axis, i) => (
                  <label key={axis}>
                    <span>{axis} (m)</span>
                    <input
                      type="number"
                      step={0.05}
                      inputMode="decimal"
                      className="sant-num"
                      value={mount[i]}
                      onChange={(e) => {
                        const next = [...mount] as [number, number, number];
                        next[i] = Number(e.target.value) || 0;
                        onMount(next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="byor-drawer__note">
                The cubes sit 0.40–0.60 m in front of 0, 0, 0. A short arm may need to sit closer. The next run uses this position.
              </p>
            </section>

            <section className="byor-drawer__section" aria-labelledby="byor-facts-title">
              <h3 id="byor-facts-title" className="byor-drawer__sub">
                Robot facts
              </h3>
              {d ? (
                <>
                  <dl className="byor-facts">
                    <div>
                      <dt>Arm joints</dt>
                      <dd className="sant-num">{d.dof}</dd>
                    </div>
                    <div>
                      <dt>Reach, est.</dt>
                      <dd className="sant-num">{metres(d.reach_m.value)}</dd>
                    </div>
                    <div>
                      <dt>Tool point</dt>
                      <dd className="sant-num">+{d.tcp.offset[2].toFixed(3)} m</dd>
                    </div>
                    <div>
                      <dt>Gripper open</dt>
                      <dd className="sant-num">{(d.gripper.open * 1000).toFixed(0)} mm</dd>
                    </div>
                  </dl>
                  <ul className="byor-drawer__list">
                    <li>Reach: {d.reach_m.source}</li>
                    <li>
                      Tool point, from <code>{d.tcp.link}</code>: {d.tcp.source}
                    </li>
                    <li>Gripper: {d.gripper.source}</li>
                  </ul>
                </>
              ) : (
                <p className="byor-drawer__note">Fix the errors on the roles to see the tool point and reach.</p>
              )}
            </section>

            <section className="byor-drawer__section" aria-labelledby="byor-data-title">
              <h3 id="byor-data-title" className="byor-drawer__sub">
                Data
              </h3>
              <p className="byor-drawer__note">
                {recorded
                  ? `Sample data: the backend at ${API_BASE} isn't running. Parts and roles are T2's real /robots responses; the report cards are T2's recorded Franka (30/30) and OpenArm (0/30) runs.`
                  : `Connected to the backend at ${API_BASE}.`}
              </p>
              <p className="byor-drawer__note sant-num">
                {upload.id}, SHA-256 {upload.sha256.slice(0, 16)}…
              </p>
            </section>
          </>
        ) : (
          report && (
            <>
              <section className="byor-drawer__section" aria-labelledby="byor-src-title">
                <h3 id="byor-src-title" className="byor-drawer__sub">
                  Where every number on the card comes from
                </h3>
                <ul className="byor-drawer__list byor-drawer__list--cols">
                  {typeof report.provenance.fixture === "string" && <li>{report.provenance.fixture as string}</li>}
                  <li>Scenes done: {report.pick_place.successes.source}</li>
                  <li>Failure reasons: {report.pick_place.failure_reasons.source}</li>
                  <li>Tracking: {report.pick_place.tracking_mean_mm.source}</li>
                  <li>Reach map: {report.reach_map.source}</li>
                  <li>Joint limits: {report.joint_limit_hits.source}</li>
                  <li>Verdict: {report.verdict.source}</li>
                  <li>Scenes: {report.task.source}</li>
                  <li>Design flaw (this page's rule): on a robot that isn't ready, the arm joint with the narrowest range among those at a limit in at least 20% of the scenes.</li>
                </ul>
              </section>
              {report.joint_limit_hits.value.length > 0 && (
                <section className="byor-drawer__section" aria-labelledby="byor-hits-title">
                  <h3 id="byor-hits-title" className="byor-drawer__sub">
                    Every joint limit reached
                  </h3>
                  <ul className="byor-drawer__list byor-drawer__list--cols byor-drawer__list--short sant-num">
                    {report.joint_limit_hits.value.map((h) => (
                      <li key={h.joint + h.limit}>
                        {h.joint} {h.limit}: {h.scenes} scenes, {h.steps} steps
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )
        )}
      </div>
    </dialog>
  );
}
