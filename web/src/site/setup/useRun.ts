// Run the report card: save the roles (PUT /roles; a 422 lists what to fix), start the job (POST /evaluate), then
// poll GET /report until it is done or failed (byor-api.md §4-6).
import { useCallback, useEffect, useRef, useState } from "react";
import { toBody } from "./roles";
import { ByorError, type Issue, type ReportCard, type ReportResponse, type RoleSet } from "./types";
import type { Robot } from "./SetupPage";

export type RunState =
  | { phase: "idle"; report: ReportCard | null; note: Issue[] }
  | { phase: "saving"; report: ReportCard | null; note: Issue[] }
  | { phase: "running"; report: ReportCard | null; progress: ReportResponse["progress"]; note: Issue[] }
  | { phase: "done"; report: ReportCard; note: Issue[] }
  | { phase: "failed"; report: ReportCard | null; error: string; note: Issue[] };

const POLL_MS = { live: 2000, fixture: 400 };

export function useRun(robot: Robot | null, roles: RoleSet | null, mount: [number, number, number], onIssues: (i: Issue[]) => void) {
  const [state, setState] = useState<RunState>({ phase: "idle", report: null, note: [] });
  const timer = useRef<number | undefined>(undefined);
  const gen = useRef(0);

  const stop = () => window.clearTimeout(timer.current);

  const poll = useCallback(
    (r: Robot, my: number, note: Issue[]) => {
      const tick = async () => {
        if (my !== gen.current) return;
        try {
          const res = await r.client.report(r.upload.id);
          if (my !== gen.current) return;
          if (res.status === "done" && res.report) return setState({ phase: "done", report: res.report, note });
          if (res.status === "failed") return setState({ phase: "failed", report: res.report, error: res.error ?? "the run failed", note });
          setState({ phase: "running", report: res.report, progress: res.progress, note });
        } catch (e) {
          // a dropped connection is not a failed run: keep polling (the client already retried once)
          if (!(e instanceof ByorError) || e.status !== 0) {
            if (my !== gen.current) return;
            const error = e instanceof ByorError ? e.message : String(e);
            return setState((s) => ({ phase: "failed", report: s.report, error, note }));
          }
        }
        timer.current = window.setTimeout(tick, POLL_MS[r.client.mode]);
      };
      void tick();
    },
    [],
  );

  // A robot that was evaluated before (the same bytes re-uploaded) shows its last card, or picks up its run.
  useEffect(() => {
    stop();
    const my = ++gen.current;
    setState({ phase: "idle", report: null, note: [] });
    if (!robot) return;
    robot.client.report(robot.upload.id).then(
      (res) => {
        if (my !== gen.current) return;
        if (res.status === "done" && res.report) setState({ phase: "done", report: res.report, note: [] });
        else if (res.status === "queued" || res.status === "running") poll(robot, my, []);
        else if (res.status === "failed") setState({ phase: "failed", report: res.report, error: res.error ?? "the last run failed", note: [] });
      },
      () => {},
    );
    return stop;
  }, [robot, poll]);

  const run = useCallback(async () => {
    if (!robot || !roles) return;
    stop();
    const my = ++gen.current;
    setState((s) => ({ phase: "saving", report: s.report, note: [] }));
    try {
      const saved = await robot.client.putRoles(robot.upload.id, toBody(roles, mount));
      const note = saved.issues;
      onIssues(note);
      await robot.client.evaluate(robot.upload.id, { seed0: 100, n: 30 });
      if (my !== gen.current) return;
      setState((s) => ({ phase: "running", report: s.report, progress: null, note }));
      poll(robot, my, note);
    } catch (e) {
      if (my !== gen.current) return;
      const errors = e instanceof ByorError ? e.errors : [];
      if (e instanceof ByorError && e.status === 422) onIssues(errors);
      setState((s) => ({
        phase: "failed",
        report: s.report,
        error: errors.length ? errors.map((x) => x.message).join("; ") : String(e),
        note: errors,
      }));
    }
  }, [robot, roles, mount, onIssues, poll]);

  return { state, run };
}
