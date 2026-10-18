import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../sant/shells/AppShell";
import { API_BASE, asUpload, backendUp, fixtureClient, liveClient, pickClient, RECORDED, type ByorClient } from "./client";
import { SlidersIcon, WarnIcon } from "./icons";
import { fromSuggested, localIssues } from "./roles";
import { RobotList } from "./RobotList";
import { RoleBoard } from "./RoleBoard";
import { RunPanel } from "./RunPanel";
import { SettingsDrawer } from "./SettingsDrawer";
import { ByorError, type Issue, type Parts, type RobotSummary, type RoleSet, type RolesBody, type UploadResult } from "./types";
import { UploadZone } from "./UploadZone";
import { useRun } from "./useRun";
import "./setup.css";

// three.js and urdf-loader load only when a robot is on screen.
const RobotPreview = lazy(() => import("./RobotPreview"));

export type Robot = { client: ByorClient; upload: UploadResult; parts: Parts; file: File | null };
type View = "roles" | "report";

const NAV = [
  { to: "/robots", label: "My robots" },
  { to: "/robots/setup", label: "Robot setup" },
];

/** How often the page looks for T2's backend while it shows sample data. */
const REPROBE_MS = 10_000;

const savedSet = (r: RolesBody): RoleSet => ({ base: r.base, arm_joints: r.arm_joints, hand: r.hand, gripper_joints: r.gripper_joints });

const asIssues = (e: unknown): Issue[] =>
  e instanceof ByorError ? e.errors : [{ code: "error", severity: "error", message: String((e as Error)?.message ?? e), where: null }];

/**
 * Robot setup, one screen with no page scroll: upload (or open a robot T2's backend already has), then two views of
 * the robot, "Parts and roles" (the tree and the 3D view) and "Report card". Rarely used settings (the mount, derived
 * facts, every source) sit in a drawer. Runs on T2's backend; the sample data is only for when it isn't running.
 */
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
  const [view, setView] = useState<View>("roles");
  const [drawer, setDrawer] = useState<"robot" | "sources" | null>(null);
  const [robots, setRobots] = useState<RobotSummary[] | null>(null);
  const { state: runState, run } = useRun(robot, roles, mount, setServerIssues);

  useEffect(() => {
    let live = true;
    (forceFixture ? Promise.resolve(fixtureClient()) : pickClient()).then((c) => live && setClient(c));
    return () => {
      live = false;
    };
  }, [forceFixture]);

  // The robots to open without uploading, fetched whenever the upload screen shows.
  useEffect(() => {
    if (!client || robot) return;
    let live = true;
    setRobots(null);
    client.list().then(
      (r) => live && setRobots(r),
      () => live && setRobots([]),
    );
    return () => {
      live = false;
    };
  }, [client, robot]);

  // On sample data, keep looking for T2's backend, and switch to it while no robot is open.
  useEffect(() => {
    if (forceFixture || client?.mode !== "fixture" || robot) return;
    const id = window.setInterval(async () => {
      if (await backendUp()) setClient(liveClient());
    }, REPROBE_MS);
    return () => window.clearInterval(id);
  }, [client, robot, forceFixture]);

  /** Open a robot: its parts, and the roles and mount it was last evaluated with (a re-upload keeps them), else the suggestion. */
  const open = async (c: ByorClient, id: string, toUpload: (parts: Parts) => UploadResult, file: File | null) => {
    const [parts, saved] = await Promise.all([c.parts(id), c.savedRoles(id).catch(() => null)]);
    setRobot({ client: c, upload: toUpload(parts), parts, file });
    setRoles(saved ? savedSet(saved) : fromSuggested(parts));
    setMount(saved?.mount?.pos ?? [0, 0, 0]);
    setServerIssues([]);
    setFocus(null);
    setView("roles");
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
    const up = await client.upload(file);
    await open(client, up.id, () => up, file);
  });

  const onOpen = (r: RobotSummary) => load(async () => {
    if (!client) return;
    const recorded = Object.values(RECORDED).find((x) => x.upload.id === r.id)?.upload;
    await open(client, r.id, (parts) => (client.mode === "fixture" && recorded ? recorded : asUpload(r, parts)), null);
  });

  const issues = useMemo(() => {
    if (!robot || !roles) return [];
    const local = localIssues(roles, robot.parts);
    const seen = new Set(local.map((i) => i.code));
    return [...local, ...[...robot.parts.issues, ...serverIssues].filter((i) => !seen.has(i.code))];
  }, [robot, roles, serverIssues]);

  const sample = robot ? robot.client.mode === "fixture" : client?.mode === "fixture";
  const running = runState.phase === "saving" || runState.phase === "running";
  const blocked = !roles || !robot || localIssues(roles, robot.parts).length > 0;
  const hasReport = running || runState.phase !== "idle" || runState.report !== null;

  return (
    <AppShell
      title="Robot setup"
      active={null}
      home="/"
      links={NAV}
      status={client ? <span className="byor-mode" data-mode={client.mode}>{client.mode === "live" ? "Backend connected" : "Sample data"}</span> : null}
      actions={
        robot ? (
          <>
            <div className="byor-views" role="group" aria-label="View">
              <button type="button" className="byor-views__btn" aria-pressed={view === "roles"} onClick={() => setView("roles")}>
                Parts and roles
              </button>
              <button type="button" className="byor-views__btn" aria-pressed={view === "report"} disabled={!hasReport} onClick={() => setView("report")}>
                Report card
              </button>
            </div>
            <button type="button" className="sant-btn sant-btn--ghost sant-btn--md" onClick={() => setDrawer("robot")} aria-haspopup="dialog">
              <SlidersIcon />
              Settings
            </button>
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
            <button
              type="button"
              className="sant-btn sant-btn--primary sant-btn--md"
              disabled={blocked || running}
              onClick={() => {
                setView("report");
                void run();
              }}
            >
              {running ? "Running…" : runState.report ? "Run again" : "Run report card"}
            </button>
          </>
        ) : null
      }
    >
      <div className="byor-page" data-view={robot ? view : "upload"}>
        {!robot || !roles ? (
          <div className="byor-start">
            {sample && (
              <p className="byor-banner" role="note">
                <span className="byor-sample">Sample data</span> The backend at {API_BASE} isn't running, so this page shows T2's recorded runs. It
                looks for the backend again every 10 seconds.
              </p>
            )}
            <div className="byor-start__row">
              <UploadZone onFile={onFile} busy={busy || !client} errors={uploadErrors} />
              <RobotList robots={client ? robots : null} sample={sample} busy={busy} onOpen={onOpen} />
            </div>
          </div>
        ) : (
          <>
            <RobotHead robot={robot} sample={sample} onDetails={() => setDrawer("robot")} />
            {view === "roles" ? (
              <div className="byor-work">
                <section className="byor-panel byor-panel--parts" aria-label="Parts and roles">
                  <RoleBoard parts={robot.parts} roles={roles} onChange={(r) => (setRoles(r), setServerIssues([]))} focus={focus} onFocus={setFocus} />
                  <IssueList issues={issues} />
                </section>
                <section className="byor-panel byor-panel--view byor-view" aria-label="3D preview">
                  <Suspense fallback={<div className="byor-view__wait">Loading the 3D view…</div>}>
                    <RobotPreview robot={robot} focus={focus} mount={mount} />
                  </Suspense>
                </section>
              </div>
            ) : (
              <RunPanel state={runState} parts={robot.parts} recorded={sample} onSources={() => setDrawer("sources")} />
            )}
            <SettingsDrawer
              open={drawer !== null}
              tab={drawer ?? "robot"}
              onClose={() => setDrawer(null)}
              robot={robot}
              mount={mount}
              onMount={setMount}
              recorded={sample}
              report={runState.report}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function RobotHead({ robot, sample, onDetails }: { robot: Robot; sample: boolean; onDetails: () => void }) {
  const { upload } = robot;
  return (
    <div className="byor-robot">
      <h2 className="byor-robot__name">{upload.name}</h2>
      <p className="byor-robot__meta">
        <span>{robot.file?.name ?? (upload.urdf || "stored on the backend")}</span>
        <span className="sant-num">{upload.n_links} links</span>
        <span className="sant-num">{upload.n_joints} joints</span>
      </p>
      {sample && (
        <button type="button" className="byor-sample byor-sample--button" onClick={onDetails}>
          Sample data: T2's recorded run, not your robot
        </button>
      )}
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

export default SetupPage;
