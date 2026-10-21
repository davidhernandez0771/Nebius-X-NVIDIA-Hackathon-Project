// The data (/data): what SANT does to real human demos, one demo at a time, in the robot twin next to the
// simulator's own camera, every view with its physics verdict; and SANT working live on a running experiment.
// Read only. ?set=<experiment> picks the experiment, ?mode=live the live view.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import { fetchSets, type Fetch } from "./api";
import { useAsync } from "./hooks";
import { LiveView } from "./LiveView";
import { Showcase } from "./Showcase";
import type { SetSummary } from "./model";
import "./data.css";

const LINKS = [
  { to: "/robots", label: "Robots" },
  { to: "/record", label: "Record" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/data", label: "Data" },
  { to: "/site/results", label: "Results" },
];

/** The experiments shown up front, in this order (tonight's mouse demos first); the store's others (earlier
 *  attempts, the repair A/B runs) sit behind "Show all". */
export const FEATURED = ["mouse20261020", "human10c"];

function summaryLine(s: SetSummary): string {
  const parts = [
    `${s.nDemos} ${s.input} demos`,
    `${s.replayVerified}/${s.nDemos} passed the physics replay`,
    `${s.repaired} repaired`,
    `${s.variantsVerified}/${s.variantsTotal} variants verified`,
  ];
  for (const e of s.evals) parts.push(`policy trained on them: ${e.k}/${e.n} unseen scenes (${e.cell})`);
  return parts.join(" · ");
}

export default function DataPage({ fetchImpl, Source }: { fetchImpl?: Fetch; Source?: typeof EventSource }) {
  const [params, setParams] = useSearchParams();
  const sets = useAsync("sets", () => fetchSets(fetchImpl));
  const list = sets.state === "ok" ? sets.value : [];
  const wanted = params.get("set");
  const featured = FEATURED.flatMap((n) => list.filter((s) => s.name === n));
  const current = list.find((s) => s.name === wanted) ?? featured[0] ?? list[0] ?? null;
  const [all, setAll] = useState(false);
  const shown = all || featured.length === 0 ? list : current && !featured.includes(current) ? [...featured, current] : featured;
  const mode = params.get("mode") === "live" ? "live" : "showcase";
  const go = (patch: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => next.set(k, v));
    return next;
  }, { replace: true });

  return (
    <AppShell
      title="The data"
      active={null}
      links={LINKS}
      actions={
        <div className="data-modes" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={mode === "showcase"} className="data-mode" onClick={() => go({ mode: "showcase" })}>
            Demo by demo
          </button>
          <button type="button" role="tab" aria-selected={mode === "live"} className="data-mode" onClick={() => go({ mode: "live" })}>
            Live
          </button>
        </div>
      }
    >
      <div className="data-page">
        <p className="data-lede">
          Real human demos, put through SANT. For each one: what the person did, the same path re-run with physics on, what SANT repaired,
          and the copies it multiplied, in the robot twin and in the simulator's own camera, each with the verdict physics gave it.
        </p>
        {sets.state === "loading" && <p className="data-note">Loading the experiments…</p>}
        {sets.state === "error" && <p className="data-note data-note--error">The experiments didn't load: {sets.message}</p>}
        {list.length > 0 && current && (
          <>
            <nav className="data-sets" aria-label="Experiments">
              {shown.map((s) => (
                <button key={s.name} type="button" className="data-set" aria-pressed={s.name === current.name} onClick={() => go({ set: s.name })}>
                  <span className="data-set__name">{s.name}</span>
                  <span className="data-set__input">{s.input}</span>
                </button>
              ))}
              {shown.length < list.length && (
                <button type="button" className="data-btn data-btn--quiet" onClick={() => setAll(true)}>
                  Show all {list.length} experiments
                </button>
              )}
            </nav>
            {/* The live view keeps its own counts as events arrive; this line is the store when the page loaded. */}
            {mode === "showcase" && <p className="data-summary">{summaryLine(current)}</p>}
            {mode === "live" ? (
              <LiveView key={current.name} name={current.name} fetchImpl={fetchImpl} Source={Source} />
            ) : (
              <Showcase key={current.name} name={current.name} fetchImpl={fetchImpl} />
            )}
          </>
        )}
        {sets.state === "ok" && list.length === 0 && <p className="data-note">No experiments in this data folder yet.</p>}
      </div>
    </AppShell>
  );
}
