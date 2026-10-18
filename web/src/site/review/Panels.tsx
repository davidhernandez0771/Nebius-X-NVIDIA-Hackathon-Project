// The Review page's DOM parts around the scan: the timeline lanes, the code-review issue list and the
// verdict card. They carry everything the canvas shows, in words, for screen readers and motion off.

import type { MouseEvent } from "react";
import type { StoredDiagnosis } from "../../pm/types";
import { durationOf, type Subject } from "./data";
import { activeIssues, detectionTag, fixedSummary, formatSpan, isWholeDemo, type IssueRow, type Verdict } from "./model";
import type { PlayState } from "./playback";

const pct = (t: number, d: number) => `${d > 0 ? (Math.min(Math.max(t, 0), d) / d) * 100 : 0}%`;

function spanStyle(w: { t?: number | null; t0?: number | null; t1?: number | null }, d: number) {
  if (w.t0 != null && w.t1 != null) return { left: pct(w.t0, d), width: `calc(${pct(w.t1, d)} - ${pct(w.t0, d)})` };
  if (w.t != null) return { left: pct(w.t, d), width: "2px" };
  return { left: "0%", width: "100%" };
}

export function Timeline({
  subject,
  rows,
  view,
  onSeek,
}: {
  subject: Subject;
  rows: IssueRow[];
  view: PlayState;
  onSeek: (mode: "raw" | "perfected", t: number) => void;
}) {
  const raw = durationOf(subject.raw.demo);
  const perf = subject.perfected ? durationOf(subject.perfected.demo) : null;
  const segs = subject.stored?.diagnosis.segments ?? [];
  const onRaw = view.mode === "raw" || (view.mode === "morph" && view.morph < 0.5);
  const seekFrom = (mode: "raw" | "perfected", d: number) => (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(mode, ((e.clientX - r.left) / r.width) * d);
  };
  return (
    <div className="rv2-timeline" role="group" aria-label="Demo timeline">
      <span className="rv2-lane-name">Issues</span>
      <div className="rv2-lane" onClick={seekFrom("raw", raw)}>
        {rows
          .filter((r) => r.kind === "issue")
          .map((r) => (
            <span key={r.index} className={`rv2-mark rv2-mark--issue${isWholeDemo(r, raw) ? " rv2-mark--whole" : ""}`} style={spanStyle(r, raw)} title={`${detectionTag(r)}, ${formatSpan(r)}`} />
          ))}
        {onRaw && <span className="rv2-head" style={{ left: pct(view.t, raw) }} />}
      </div>
      <span className="rv2-lane-name">Phases</span>
      <div className="rv2-lane rv2-lane--phases" onClick={seekFrom("raw", raw)}>
        {segs.map((s, k) => (
          <span key={k} className="rv2-seg" style={spanStyle(s, raw)}>
            {s.name}
          </span>
        ))}
        {onRaw && <span className="rv2-head" style={{ left: pct(view.t, raw) }} />}
      </div>
      <span className="rv2-lane-name">Fixes</span>
      <div className="rv2-lane" onClick={seekFrom("raw", raw)}>
        {rows
          .flatMap((r) => r.fixes)
          .map((f, k) => (
            <span key={k} className={`rv2-mark rv2-mark--fix${isWholeDemo(f, raw) ? " rv2-mark--whole" : ""}`} style={spanStyle(f, raw)} title={`${f.op}, ${formatSpan(f)}`} />
          ))}
        {onRaw && <span className="rv2-head" style={{ left: pct(view.t, raw) }} />}
      </div>
      {perf != null && (
        <>
          <span className="rv2-lane-name rv2-lane-name--teal">Perfected</span>
          <div className="rv2-lane rv2-lane--perfected" onClick={seekFrom("perfected", perf)} style={{ width: pct(perf, raw) }}>
            <span className="rv2-mark rv2-mark--perfected" style={{ left: 0, width: "100%" }} />
            {!onRaw && <span className="rv2-head rv2-head--teal" style={{ left: pct(view.t, perf) }} />}
          </div>
        </>
      )}
      <div className="rv2-axis sant-num" aria-hidden="true">
        <span>0 s</span>
        {perf != null && <span style={{ left: pct(perf, raw) }}>{perf.toFixed(2)} s</span>}
        <span>{raw.toFixed(2)} s</span>
      </div>
    </div>
  );
}

const OP_TEXT: Record<string, string> = {
  trim: "cuts the idle ends",
  remove_pause: "removes the pause",
  smooth: "smooths the motion",
  retime: "speeds it up",
  recenter_grasp: "re-centers the grasp",
  replan_transit: "re-plans the carry over the rim",
  discard: "drops the demo",
};

function fixText(f: { op: string; [k: string]: unknown }) {
  const extra = typeof f.strength === "string" ? ` (${f.strength})` : "";
  return `${OP_TEXT[f.op] ?? f.op}${extra}`;
}

export function IssueList({
  rows,
  view,
  duration,
  onPick,
}: {
  rows: IssueRow[];
  view: PlayState;
  duration: number;
  onPick: (t: number) => void;
}) {
  const live = new Set(view.mode === "raw" ? activeIssues(rows, view.t, duration).map((r) => r.index) : []);
  if (rows.length === 0) return <p className="rv2-quiet">No issues found, and nothing was fixed.</p>;
  return (
    <ol className="rv2-review">
      {rows.map((r) => (
        <li key={r.index} className={`rv2-hunk rv2-hunk--${r.kind}${live.has(r.index) ? " is-live" : ""}`}>
          <button type="button" className="rv2-hunk__head" onClick={() => onPick(r.t0 ?? r.t ?? 0)} disabled={r.kind === "gated"}>
            <span className="rv2-hunk__when sant-num">{r.kind === "gated" ? "dropped" : formatSpan(r)}</span>
            <span className="rv2-hunk__tag">{r.kind === "fix-only" ? "Fix" : r.kind === "gated" ? "Claim" : detectionTag(r)}</span>
          </button>
          {r.evidence && (
            <p className="rv2-line rv2-line--minus sant-num">
              <span aria-hidden="true">−</span>
              <span className={r.kind === "gated" ? "rv2-struck" : undefined}>{r.evidence}</span>
              {r.kind === "gated" && <span className="rv2-why">dropped: the measured metrics contradict it</span>}
            </p>
          )}
          {r.fixes.map((f, k) => (
            <p key={k} className="rv2-line rv2-line--plus sant-num">
              <span aria-hidden="true">+</span>
              <span>
                <code>{f.op}</code> {fixText(f)}
                {(f.t0 != null || f.t != null) && <span className="rv2-dim"> · {formatSpan(f)}</span>}
              </span>
            </p>
          ))}
          {r.kind === "issue" && r.fixes.length === 0 && <p className="rv2-line rv2-dim">No fix from the menu for this one.</p>}
        </li>
      ))}
    </ol>
  );
}

function Corners() {
  return (
    <>
      <span className="rv2-corner rv2-corner--tl" aria-hidden="true" />
      <span className="rv2-corner rv2-corner--tr" aria-hidden="true" />
      <span className="rv2-corner rv2-corner--bl" aria-hidden="true" />
      <span className="rv2-corner rv2-corner--br" aria-hidden="true" />
    </>
  );
}

export function VerdictCard({ verdict, rows, subject }: { verdict: Verdict; rows: IssueRow[]; subject: Subject }) {
  const { physics, label } = verdict;
  const sum = fixedSummary(rows);
  const before = subject.raw.verification;
  return (
    <section className="rv2-verdict" aria-labelledby="rv2-verdict-title">
      <Corners />
      <h2 id="rv2-verdict-title" className="rv2-verdict__title">
        Verdict
      </h2>
      <dl className="rv2-verdict__rows">
        <dt>Physics</dt>
        <dd>
          {physics.state === "verified" && (
            <>
              <span className="rv2-ok">Verified ✓</span> the cube ended in the bin. Replay {physics.duration.toFixed(2)} s, path{" "}
              {physics.pathLength.toFixed(2)} m.
            </>
          )}
          {physics.state === "failed" && (
            <>
              <span className="rv2-bad">Failed ✗</span> {physics.reasons.length ? physics.reasons.join(", ") : "the cube did not end in the bin"}.
            </>
          )}
          {physics.state === "unknown" && <span className="rv2-dim">Not served by this backend yet. Perfect runs the physics replay.</span>}
        </dd>

        <dt>Label</dt>
        <dd>
          {label ? (
            <>
              “{label.text}”<span className="rv2-dim"> written by the {label.author}</span>
            </>
          ) : (
            <span className="rv2-dim">None yet: the demo isn't reviewed.</span>
          )}
        </dd>

        <dt>Matches your request</dt>
        <dd>
          <span className="rv2-dim">Not checked yet.</span> Nemotron's check of the label against what you asked for is coming next.
        </dd>

        <dt>Fixed</dt>
        <dd>
          {sum.issues} {sum.issues === 1 ? "issue" : "issues"}, {sum.fixes} {sum.fixes === 1 ? "fix" : "fixes"}
          {sum.gated > 0 && `, ${sum.gated} claim${sum.gated === 1 ? "" : "s"} dropped`}
          {subject.stored && <span className="rv2-dim"> · found by {subject.stored.source === "nemotron" ? subject.stored.model_id ?? "Nemotron" : "the rules detector"}</span>}
        </dd>
      </dl>

      {before && physics.state !== "unknown" && (
        <table className="rv2-delta sant-num">
          <caption className="sant-sr-only">Raw and perfected replays compared</caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Raw</th>
              <th scope="col">Perfected</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Length</th>
              <td>{before.duration.toFixed(2)} s</td>
              <td>{physics.duration.toFixed(2)} s</td>
            </tr>
            <tr>
              <th scope="row">Path</th>
              <td>{before.path_length.toFixed(2)} m</td>
              <td>{physics.pathLength.toFixed(2)} m</td>
            </tr>
            <tr>
              <th scope="row">In the bin</th>
              <td>{before.success ? "yes" : "no"}</td>
              <td>{physics.state === "verified" ? "yes" : "no"}</td>
            </tr>
          </tbody>
        </table>
      )}

      {subject.secondOpinion && <SecondOpinion stored={subject.secondOpinion} rulesIssues={sum.issues} earlier={subject.example} />}
    </section>
  );
}

function SecondOpinion({ stored, rulesIssues, earlier }: { stored: StoredDiagnosis; rulesIssues: number; earlier: boolean }) {
  const n = stored.diagnosis.issues.length;
  const who = stored.source === "nemotron" ? stored.model_id ?? "Nemotron" : "The rules detector";
  return (
    <p className="rv2-second">
      <strong>Second opinion.</strong> {who} {earlier && "(an earlier, sprint 3 run)"} looked at the same raw demo: {n === 0 ? "no issues" : `${n} issues`}, decision “
      {stored.diagnosis.decision}”. The rules found {rulesIssues}. That's why code measures the motion and physics decides.
    </p>
  );
}
