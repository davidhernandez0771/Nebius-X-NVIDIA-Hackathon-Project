import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, GlassCard, StatusPill, Zones } from "../../components";
import { describeError, PmApiError, pmApi } from "../../../pm/api";
import { LoadError, Loading, PageTitle, useLoad } from "../common";
import type { Demo } from "../../../pm/types";
import { summarizeDemos } from "../../../pm/dataset/summary";
import "../pm.css";

const fmtRatio = (v: number | null) => (v === null ? "none yet" : v.toFixed(1));

type ExportState = { state: "idle" } | { state: "running" } | { state: "done" } | { state: "error"; message: string };

function exportMessage(err: unknown): string {
  if (err instanceof PmApiError && err.kind === "route_missing")
    return "Export isn't on this backend yet. Run lerobot_tools/export.py from the README instead.";
  return describeError(err);
}

function Flow({ demos }: { demos: Demo[] }) {
  const s = summarizeDemos(demos);
  return (
    <GlassCard as="section" className="stack">
      <h2>From one human demo to many</h2>
      <ol className="pm-flow" aria-label="Demos by source">
        <li className="pm-flow-step pm-flow-step--human">
          <span className="pm-flow-count" data-testid="count-human">
            {s.counts.human}
          </span>
          <span>Human demos</span>
          <span className="pm-flow-ratio">{s.humanMinutes.toFixed(1)} minutes of human time</span>
        </li>
        <li className="pm-flow-step">
          <span className="pm-flow-count" data-testid="count-repaired">
            {s.counts.repaired}
          </span>
          <span>Perfected</span>
          <span className="pm-flow-ratio">{fmtRatio(s.perfectedPerHuman)} per human demo</span>
        </li>
        <li className="pm-flow-step pm-flow-step--variant">
          <span className="pm-flow-count" data-testid="count-variant">
            {s.counts.variant}
          </span>
          <span>Multiplied variants</span>
          <span className="pm-flow-ratio">{fmtRatio(s.variantsPerPerfected)} per perfected demo</span>
        </li>
      </ol>
      <p className="muted pm-note">
        The multiplication yield (verified variants out of every attempt) also needs the failed attempts, which the
        demo store doesn't keep. It comes from the experiment summary and appears on Results once measured.
      </p>
    </GlassCard>
  );
}

function RecentDemos({ demos }: { demos: Demo[] }) {
  return (
    <GlassCard as="section" className="stack">
      <h2>Latest demos</h2>
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead>
            <tr>
              <th scope="col">Demo</th>
              <th scope="col">Source</th>
              <th scope="col">Robot</th>
              <th scope="col">Length</th>
            </tr>
          </thead>
          <tbody>
            {demos.slice(0, 12).map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/pm/review?id=${encodeURIComponent(d.id)}`}>{d.id}</Link>
                </td>
                <td>{d.source}</td>
                <td>{d.scene.robot}</td>
                <td>{(d.trajectory.t[d.trajectory.t.length - 1] - d.trajectory.t[0]).toFixed(1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

export default function DatasetPage() {
  const [load, reload] = useLoad(pmApi.listDemos, "demos");
  const [exp, setExp] = useState<ExportState>({ state: "idle" });

  async function runExport() {
    setExp({ state: "running" });
    try {
      await pmApi.exportDataset();
      setExp({ state: "done" });
    } catch (e) {
      setExp({ state: "error", message: exportMessage(e) });
    }
  }

  const demos = load.state === "ok" ? load.data : [];
  return (
    <Zones
      hero={
        <>
          <PageTitle title="Dataset">
            Every demo in the store, by where it came from. Only demos that passed the physics check are exported.
          </PageTitle>
          {load.state === "loading" && <Loading what="demos" />}
          {load.state === "error" && <LoadError error={load.error} onRetry={reload} />}
          {load.state === "ok" && demos.length === 0 && (
            <EmptyState
              title="No demos yet"
              hint="Record one with your webcam, or load a demo set into the store."
              to="/pm/record"
              cta="Record a demo"
            />
          )}
          {demos.length > 0 && (
            <>
              <Flow demos={demos} />
              <RecentDemos demos={demos} />
            </>
          )}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <h2>Export</h2>
        <p className="muted small">
          Writes the verified demos as a LeRobot v3.0 dataset, each with its passport: lineage, repairs applied and
          which model diagnosed it.
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={runExport}
          disabled={exp.state === "running" || demos.length === 0}
        >
          Export to LeRobot
        </button>
        {exp.state === "running" && <StatusPill>Exporting…</StatusPill>}
        {exp.state === "done" && <StatusPill tone="accent">Exported</StatusPill>}
        {exp.state === "error" && (
          <p className="small" role="alert">
            {exp.message}
          </p>
        )}
      </GlassCard>
    </Zones>
  );
}
