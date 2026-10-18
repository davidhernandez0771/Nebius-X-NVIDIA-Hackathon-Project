import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import { API_BASE, fixtureClient, pickClient, RECORDED, type ByorClient, type Sample } from "./client";
import { metres } from "./fmt";
import { WarnIcon } from "./icons";
import { fromSuggested, localIssues } from "./roles";
import { RoleBoard } from "./RoleBoard";
import { RunPanel } from "./RunPanel";
import { ByorError, type Issue, type Parts, type RoleSet, type UploadResult } from "./types";
import { UploadZone } from "./UploadZone";
import { useRun } from "./useRun";
import "./setup.css";

// three.js and urdf-loader load only when a robot is on screen.
const RobotPreview = lazy(() => import("./RobotPreview"));

export type Robot = { client: ByorClient; upload: UploadResult; parts: Parts; file: File | null };

const NAV = [
  { to: "/robots", label: "My robots" },
  { to: "/robots/setup", label: "Robot setup" },
];

const asIssues = (e: unknown): Issue[] =>
  e instanceof ByorError ? e.errors : [{ code: "error", severity: "error", message: String((e as Error)?.message ?? e), where: null }];

export function SetupPage() {
  const [params] = useSearchParams();
  const forceFixture = params.get("fixture") === "1";
  const [client, setClient] = useState<ByorClient | null>(null);
  const [robot, setRobot] = useState<Robot | null>(null);
  const [roles, setRoles] = useState<RoleSet | null>(null);
  const [mount, setMount] = useState<[number, number, number]>([0, 0, 0]);
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<Issue[]>([]);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const { state: runState, run } = useRun(robot, roles, mount, setServerIssues);
  const runRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    (forceFixture ? Promise.resolve(fixtureClient()) : pickClient()).then((c) => live && setClient(c));
    return () => {
      live = false;
    };
  }, [forceFixture]);

  const open = async (c: ByorClient, upload: UploadResult, file: File | null, sample?: Sample) => {
    const parts = await c.parts(upload.id);
    setRobot({ client: c, upload, parts, file });
    setRoles(fromSuggested(parts));
    setMount((sample && RECORDED[sample].roles.roles.mount?.pos) || [0, 0, 0]);
    setServerIssues([]);
    setFocus(null);
  };

  const load = async (fn: () => Promise<void>) => {
    setBusy(true);
    setUploadErrors([]);
    try {
      await fn();
    } catch (e) {
      setUploadErrors(asIssues(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File) => load(async () => {
    if (!client) return;
    await open(client, await client.upload(file), file);
  });

  const onSample = (s: Sample) => load(async () => {
    const c = fixtureClient();
    await open(c, await c.sample(s), null, s);
  });

  const issues = useMemo(() => {
    if (!robot || !roles) return [];
    const local = localIssues(roles, robot.parts);
    const seen = new Set(local.map((i) => i.code));
    return [...local, ...[...robot.parts.issues, ...serverIssues].filter((i) => !seen.has(i.code))];
  }, [robot, roles, serverIssues]);

  const recorded = robot?.client.mode === "fixture" || client?.mode === "fixture";
  const running = runState.phase === "saving" || runState.phase === "running";
  const blocked = !roles || !robot || localIssues(roles, robot.parts).length > 0;
  const startRun = () => {
    void run();
    const reduce = document.documentElement.dataset.motion === "reduced";
    requestAnimationFrame(() => runRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  };
  const runButton = (
    <button type="button" className="sant-btn sant-btn--primary sant-btn--md" disabled={blocked || running} onClick={startRun}>
      {running ? "Running…" : runState.report ? "Run again" : "Run report card"}
    </button>
  );

  return (
    <AppShell
      title="Robot setup"
      active={null}
      home="/"
      links={NAV}
      status={client ? <span className="byor-mode" data-mode={client.mode}>{client.mode === "live" ? "Backend connected" : "Recorded data"}</span> : null}
      actions={
        robot ? (
          <>
            <button
              type="button"
              className="sant-btn sant-btn--secondary sant-btn--md"
              onClick={() => {
                setRobot(null);
                setRoles(null);
              }}
            >
              Set up another robot
            </button>
            {runButton}
          </>
        ) : null
      }
    >
      {recorded && (
        <p className="byor-banner" role="note">
          {client?.mode === "fixture"
            ? `The backend at ${API_BASE} isn't answering, so this page runs on recorded data: T2's Franka (30/30) and OpenArm (0/30) runs. Start the backend to set up a new robot.`
            : "Recorded robot: its parts and report card are T2's recorded run, not a new simulation."}
        </p>
      )}

      {!robot || !roles ? (
        <UploadZone onFile={onFile} onSample={onSample} busy={busy || !client} errors={uploadErrors} />
      ) : (
        <>
          <RobotHead robot={robot} />
          <div className="byor-work">
            <section className="byor-panel byor-panel--parts" aria-labelledby="byor-parts-title">
              <header className="byor-panel__head">
                <h2 id="byor-parts-title" className="byor-panel__title">
                  Parts and roles
                </h2>
                <p className="byor-panel__sub">Roles come pre-filled from the URDF. Check them, then run the report card.</p>
              </header>
              <RoleBoard parts={robot.parts} roles={roles} onChange={(r) => (setRoles(r), setServerIssues([]))} focus={focus} onFocus={setFocus} />
              <IssueList issues={issues} />
              <div className="byor-panel__run">{runButton}</div>
            </section>

            <aside className="byor-panel byor-panel--view" aria-label="3D preview and robot facts">
              <div className="byor-view">
                <Suspense fallback={<div className="byor-view__wait">Loading the 3D view…</div>}>
                  <RobotPreview robot={robot} focus={focus} mount={mount} />
                </Suspense>
              </div>
              <Facts parts={robot.parts} mount={mount} onMount={setMount} />
            </aside>
          </div>
          <RunPanel ref={runRef} state={runState} parts={robot.parts} recorded={robot.client.mode === "fixture"} />
        </>
      )}
    </AppShell>
  );
}

function RobotHead({ robot }: { robot: Robot }) {
  const { upload } = robot;
  return (
    <div className="byor-robot">
      <h2 className="byor-robot__name">{upload.name}</h2>
      <p className="byor-robot__meta">
        <span>{robot.file?.name ?? upload.urdf}</span>
        <span className="sant-num">{upload.n_links} links</span>
        <span className="sant-num">{upload.n_joints} joints</span>
        <span className="sant-num" title={`SHA-256 ${upload.sha256}`}>
          {upload.id}
        </span>
      </p>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length)
    return (
      <p className="byor-ok" role="status">
        Every role is set. Ready to run.
      </p>
    );
  return (
    <ul className="byor-issues" aria-label="Problems to fix" aria-live="polite">
      {issues.map((i) => (
        <li key={i.code + i.message} className="byor-issue" data-severity={i.severity}>
          <WarnIcon className="byor-issue__icon" />
          <span>
            <strong>{i.severity === "error" ? "Fix" : "Note"}:</strong> {i.message} <code>{i.code}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Facts({ parts, mount, onMount }: { parts: Parts; mount: [number, number, number]; onMount: (m: [number, number, number]) => void }) {
  const d = parts.derived;
  return (
    <div className="byor-facts">
      {d ? (
        <dl className="byor-facts__list">
          <div>
            <dt>Arm joints</dt>
            <dd className="sant-num">{d.dof}</dd>
          </div>
          <div>
            <dt>Reach, estimated</dt>
            <dd className="sant-num" title={d.reach_m.source}>
              {metres(d.reach_m.value)}
            </dd>
          </div>
          <div>
            <dt>Tool point</dt>
            <dd className="sant-num" title={d.tcp.source}>
              {d.tcp.link} +{d.tcp.offset[2].toFixed(3)} m
            </dd>
          </div>
          <div>
            <dt>Gripper open</dt>
            <dd className="sant-num" title={d.gripper.source}>
              {(d.gripper.open * 1000).toFixed(0)} mm
            </dd>
          </div>
        </dl>
      ) : (
        <p className="byor-facts__none">Fix the errors to see the tool point and reach.</p>
      )}
      <fieldset className="byor-mount">
        <legend>Where the base sits (m)</legend>
        {(["x", "y", "z"] as const).map((axis, i) => (
          <label key={axis}>
            <span>{axis}</span>
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
        <p className="byor-mount__hint">The cubes sit 0.40–0.60 m in front of 0, 0, 0. A short arm may need to sit closer.</p>
      </fieldset>
      {d && (
        <details className="byor-sources">
          <summary>Where these numbers come from</summary>
          <ul>
            <li>Reach: {d.reach_m.source}</li>
            <li>Tool point: {d.tcp.source}</li>
            <li>Gripper: {d.gripper.source}</li>
          </ul>
        </details>
      )}
    </div>
  );
}

export default SetupPage;
