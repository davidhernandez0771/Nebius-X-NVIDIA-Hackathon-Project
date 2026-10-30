// Review (sprint 9, route /review2): what physics and Nemotron decided about a demo, what was wrong
// with it and what was fixed, as one scan from the raw demo to the perfected one.
// Content: docs/design/content-spec.md §7. Data: the backend (as /pm/review), or the recorded example.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { describeError, pmApi } from "../../pm/api";
import { createMockJobs, pollJob, startPerfect, type Diagnoser, type Job } from "../../pm/jobs";
import type { Demo } from "../../pm/types";
import { AppShell, useMotion } from "../../sant";
import { EXAMPLE_ID, durationOf, exampleSubject, loadSubject, type Subject } from "./data";
import { buildIssueRows, verdictOf } from "./model";
import { IssueList, Timeline, VerdictCard } from "./Panels";
import { SPEED, usePlayback } from "./playback";
import ScanStage from "./ScanStage";
import "./review2.css";

const LINKS = [
  { to: "/pm/record", label: "Record" },
  { to: "/review2", label: "Review" },
  { to: "/pm/dataset", label: "Dataset" },
];

type ListState = { state: "loading" } | { state: "ok"; demos: Demo[] } | { state: "error"; message: string };
type SubjectState = { state: "loading" } | { state: "ok"; subject: Subject } | { state: "error"; message: string };

function useDemoList(): ListState {
  const [s, set] = useState<ListState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    pmApi
      .listDemos()
      .then((demos) => live && set({ state: "ok", demos }))
      .catch((e) => live && set({ state: "error", message: describeError(e) }));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

function useSubject(id: string): SubjectState {
  const [s, set] = useState<SubjectState>(() => (id === EXAMPLE_ID ? { state: "ok", subject: exampleSubject } : { state: "loading" }));
  useEffect(() => {
    if (id === EXAMPLE_ID) {
      set({ state: "ok", subject: exampleSubject });
      return;
    }
    let live = true;
    set({ state: "loading" });
    loadSubject(id)
      .then((subject) => live && set({ state: "ok", subject }))
      .catch((e) => live && set({ state: "error", message: describeError(e) }));
    return () => {
      live = false;
    };
  }, [id]);
  return s;
}

function Picker({ list, current }: { list: ListState; current: string }) {
  const demos = list.state === "ok" ? list.demos.slice(0, 40) : [];
  return (
    <nav className="rv2-picker" aria-label="Demos">
      <ul>
        {demos.map((d) => (
          <li key={d.id}>
            <Link to={`/review2?id=${encodeURIComponent(d.id)}`} aria-current={d.id === current ? "page" : undefined}>
              {d.id}
              <em>{d.source}</em>
            </Link>
          </li>
        ))}
        <li>
          <Link to={`/review2?id=${EXAMPLE_ID}`} aria-current={current === EXAMPLE_ID ? "page" : undefined}>
            s1_0002
            <em>recorded example</em>
          </Link>
        </li>
      </ul>
      {list.state === "loading" && <p className="rv2-quiet">Looking for the backend…</p>}
      {list.state === "ok" && list.demos.length === 0 && (
        <p className="rv2-quiet">
          No demos yet. <Link to="/pm/record">Record one with your webcam.</Link>
        </p>
      )}
    </nav>
  );
}

const mockJobs = createMockJobs();

function PerfectBox({ demo }: { demo: Demo }) {
  const [diagnoser, setDiagnoser] = useState<Diagnoser>("rules");
  const [job, setJob] = useState<Job | null>(null);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function perfect() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const started = await startPerfect(pmApi, mockJobs, demo.id, diagnoser);
      setMock(started.mock);
      const done = await pollJob(started.backend, started.jobId, { signal: ctrl.signal, onUpdate: (j) => !ctrl.signal.aborted && setJob(j) });
      if (done && !ctrl.signal.aborted) setJob(done);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(describeError(e));
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="rv2-perfect" aria-labelledby="rv2-perfect-title">
      <h2 id="rv2-perfect-title" className="rv2-h">
        Perfect this demo
      </h2>
      <p className="rv2-quiet">Diagnose it, fix it from the fixed menu, then replay it in Isaac Lab. The sim worker must be running.</p>
      <fieldset className="rv2-choice" disabled={busy}>
        <legend className="sant-sr-only">Who finds the issues</legend>
        <label>
          <input type="radio" name="rv2-diag" checked={diagnoser === "rules"} onChange={() => setDiagnoser("rules")} /> Rules detector
          <span className="rv2-dim"> free</span>
        </label>
        <label>
          <input type="radio" name="rv2-diag" checked={diagnoser === "nemotron"} onChange={() => setDiagnoser("nemotron")} /> Nemotron 3.5 Super VL
          <span className="rv2-dim"> a billed Token Factory call</span>
        </label>
      </fieldset>
      <button type="button" className="rv2-btn rv2-btn--primary" onClick={perfect} disabled={busy}>
        {busy ? "Perfecting…" : "Perfect this demo"}
      </button>
      <div aria-live="polite" className="rv2-job">
        {mock && <p className="rv2-warn">This backend has no perfect route yet: a stand-in job ran, and nothing was perfected.</p>}
        {job && <p>Job {job.status === "succeeded" ? "finished" : job.status}{job.outcome ? `: ${job.outcome}` : ""}.</p>}
        {job?.status === "failed" && job.error && <p className="rv2-dim">{job.error}</p>}
        {job?.status === "succeeded" && job.demoId && <Link to={`/review2?id=${encodeURIComponent(job.demoId)}`}>Open the perfected demo</Link>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

function Review({ subject }: { subject: Subject }) {
  const { reduced } = useMotion();
  const rows = useMemo(() => (subject.stored ? buildIssueRows(subject.stored) : []), [subject]);
  const verdict = useMemo(
    () =>
      verdictOf({
        stored: subject.stored,
        verification: subject.perfected ? subject.perfected.verification : subject.raw.verification,
        card: subject.verdict,
        physicsDetail: subject.physicsDetail,
      }),
    [subject],
  );
  const raw = durationOf(subject.raw.demo);
  const perf = subject.perfected ? durationOf(subject.perfected.demo) : null;
  const durations = useMemo(() => ({ raw, perfected: perf }), [raw, perf]);
  const pb = usePlayback(durations, { autoplay: !reduced });
  const { view, pause } = pb;
  // Turning effects off mid-scan stops it where it is; Play still works, as a choice the user makes.
  useEffect(() => {
    if (reduced) pause();
  }, [reduced, pause]);
  const onRaw = view.mode === "raw" || (view.mode === "morph" && view.morph < 0.5);

  return (
    <>
      <ScanStage subject={subject} rows={rows} play={pb.ref} reduced={reduced} />
      <div className="rv2-transport">
        {view.playing ? (
          <button type="button" className="rv2-btn" onClick={pb.pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="rv2-btn" onClick={pb.play}>
            Play
          </button>
        )}
        <button type="button" className="rv2-btn" onClick={pb.replay}>
          Replay from the start
        </button>
        {perf != null && (
          <div className="rv2-seg-toggle" role="group" aria-label="Which demo">
            <button type="button" aria-pressed={onRaw} onClick={() => pb.seek("raw", 0)}>
              Raw <span className="sant-num">{raw.toFixed(2)} s</span>
            </button>
            <button type="button" aria-pressed={!onRaw} onClick={() => pb.seek("perfected", perf)}>
              Perfected <span className="sant-num">{perf.toFixed(2)} s</span>
            </button>
          </div>
        )}
        <span className="rv2-dim rv2-speed">Plays at {SPEED}× sim time</span>
        <span className="sant-sr-only" aria-live="polite">
          {onRaw ? "Showing the raw demo" : "Showing the perfected demo"}
        </span>
      </div>
      <Timeline subject={subject} rows={rows} view={view} onSeek={pb.seek} />
      {!subject.stored && <p className="rv2-quiet">Not reviewed yet. Perfect runs the diagnosis, the fixes and the physics check.</p>}
      <div className="rv2-cols">
        <section aria-labelledby="rv2-issues-title">
          <h2 id="rv2-issues-title" className="rv2-h">
            Issues and fixes
          </h2>
          <IssueList rows={rows} view={view} duration={raw} onPick={(t) => pb.seek("raw", t)} />
        </section>
        <VerdictCard verdict={verdict} rows={rows} subject={subject} />
      </div>
      {!subject.example && subject.raw.demo.source === "human" && !subject.perfected && <PerfectBox demo={subject.raw.demo} />}
    </>
  );
}

export default function ReviewPage2() {
  const [params] = useSearchParams();
  const list = useDemoList();
  const id = params.get("id") ?? EXAMPLE_ID;
  const subject = useSubject(id);
  const unreachable = list.state === "error";

  return (
    <AppShell title="Review" active={2} links={LINKS} home="/site">
      <div className="rv2">
        <Picker list={list} current={id} />
        <div className="rv2-main">
          {subject.state === "ok" && subject.subject.example && (
            <p className="rv2-note">
              <strong>Recorded example.</strong> A synthetic demo: the scripted expert with tremor, pauses and idle time added on purpose,
              then perfected by the rules and replayed in Isaac Lab. Every value is the run's own; Nemotron's label and match are its
              real replies from the 2026-10-18 labeler/judge test.
              {unreachable && " The SANT backend isn't reachable, so live demos can't be listed. Start it with start.ps1 -Backend, then reload."}
            </p>
          )}
          {subject.state === "loading" && <p className="rv2-quiet">Loading demo {id}…</p>}
          {subject.state === "error" && (
            <p className="rv2-warn" role="alert">
              {subject.message} <Link to={`/review2?id=${EXAMPLE_ID}`}>Open the recorded example</Link>
            </p>
          )}
          {subject.state === "ok" && <Review key={id} subject={subject.subject} />}
        </div>
      </div>
    </AppShell>
  );
}
