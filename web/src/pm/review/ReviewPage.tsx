import { Fragment, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, GlassCard, StatusPill, Zones } from "../../components";
import { pmApi } from "../api";
import { LoadError, Loading, PageTitle, useLoad } from "../common";
import type { Demo, StoredDiagnosis } from "../types";
import DemoStrip from "./DemoStrip";
import PerfectPanel from "./PerfectPanel";
import SpeedChart from "./SpeedChart";
import "../pm.css";

interface Detail {
  demo: Demo;
  stored: StoredDiagnosis | null;
  parent: Demo | null;
}

async function loadDetail(id: string): Promise<Detail> {
  const demo = await pmApi.getDemo(id);
  const [stored, parent] = await Promise.all([
    pmApi.getDiagnosis(id),
    // A missing parent only loses the comparison, so it doesn't fail the page.
    demo.parent_id ? pmApi.getDemo(demo.parent_id).catch(() => null) : Promise.resolve(null),
  ]);
  return { demo, stored, parent };
}

const durationOf = (d: Demo) => d.trajectory.t[d.trajectory.t.length - 1] - d.trajectory.t[0];

function Passport({ demo, stored }: Detail) {
  const rows: [string, ReactNode][] = [
    ["Source", demo.source],
    [
      "Parent",
      demo.parent_id ? <Link to={`/pm/review?id=${encodeURIComponent(demo.parent_id)}`}>{demo.parent_id}</Link> : "none",
    ],
    ["Robot", demo.scene.robot],
    ["Scene seed", demo.scene.seed],
    ["Human time", `${demo.human_seconds.toFixed(0)} s`],
    ["Recorded", new Date(demo.created_at).toLocaleString()],
    ["Diagnosis", stored ? (stored.source === "nemotron" ? stored.model_id ?? "nemotron" : "rules") : "none yet"],
    ["Physics check", "not served by this backend yet"],
  ];
  return (
    <GlassCard as="section" className="stack">
      <h2>Passport</h2>
      <dl className="pm-status-list">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
    </GlassCard>
  );
}

function DemoList({ demos, current }: { demos: Demo[]; current: string | null }) {
  return (
    <GlassCard as="section" className="stack">
      <h2>Demos</h2>
      <ul className="pm-list">
        {demos.slice(0, 30).map((d) => (
          <li key={d.id}>
            <Link to={`/pm/review?id=${encodeURIComponent(d.id)}`} aria-current={d.id === current ? "page" : undefined}>
              {d.id}
            </Link>
            <span className="muted">{d.source}</span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  const { demo, stored, parent } = detail;
  const duration = durationOf(demo);
  return (
    <>
      <GlassCard as="section" className="stack">
        <h2>Timeline</h2>
        {stored ? (
          <DemoStrip duration={duration} stored={stored} />
        ) : (
          <p className="muted">Not diagnosed yet. Perfect runs the diagnosis first, then repairs and verifies.</p>
        )}
      </GlassCard>
      <GlassCard as="section" className="stack">
        <h2>Before and after</h2>
        <SpeedChart after={demo.trajectory} before={parent?.trajectory} />
        <p className="muted small pm-note">
          Replay clips need the backend to serve recorded frames, which it doesn't yet. Until then this compares how
          fast the hand moves.
        </p>
      </GlassCard>
    </>
  );
}

export default function ReviewPage({ pollIntervalMs = 1000 }: { pollIntervalMs?: number }) {
  const [params] = useSearchParams();
  const id = params.get("id");
  const [list, reloadList] = useLoad(pmApi.listDemos, "list");
  const [detail, reloadDetail] = useLoad(() => (id ? loadDetail(id) : Promise.resolve(null)), id ?? "");

  const demos = list.state === "ok" ? list.data : [];
  let hero: ReactNode;
  if (!id) {
    if (list.state === "loading") hero = <Loading what="demos" />;
    else if (list.state === "error") hero = <LoadError error={list.error} onRetry={reloadList} />;
    else if (demos.length === 0)
      hero = (
        <EmptyState
          title="No demos yet"
          hint="Record one with your webcam, or load a demo set into the store."
          to="/pm/record"
          cta="Record a demo"
        />
      );
    else hero = <EmptyState title="Pick a demo to review" hint="Choose one from the list." />;
  } else if (detail.state === "loading") hero = <Loading what={`demo ${id}`} />;
  else if (detail.state === "error") hero = <LoadError error={detail.error} onRetry={reloadDetail} />;
  else if (detail.data) hero = <DetailView detail={detail.data} />;

  const loaded = id && detail.state === "ok" && detail.data ? detail.data : null;
  return (
    <Zones
      hero={
        <>
          <PageTitle title={loaded ? loaded.demo.id : "Review"}>
            {loaded ? (
              <span className="pm-num">
                {loaded.demo.source} demo, {durationOf(loaded.demo).toFixed(1)} s on {loaded.demo.scene.robot}
              </span>
            ) : (
              "What the model found in each demo, what code repaired, and what the physics replay decided."
            )}
          </PageTitle>
          {hero}
        </>
      }
    >
      {loaded && <PerfectPanel key={loaded.demo.id} demo={loaded.demo} pollIntervalMs={pollIntervalMs} />}
      {loaded && <Passport {...loaded} />}
      {demos.length > 0 && <DemoList demos={demos} current={id} />}
      {list.state === "error" && id && <StatusPill tone="danger">Demo list unavailable</StatusPill>}
    </Zones>
  );
}
