// The "Perfect" job: POST /demos/{id}/perfect -> 202 {job_id}, then poll
// GET /jobs/{id} until it finishes (plan sprint 3, T4 task 3; spec 8.9:
// "Sim worker jobs run asynchronously; the UI polls job status").
//
// T4 owns the backend side and hadn't merged it when this was written, so
// normalizeJob() accepts the likely spellings of each field. When the route
// is missing (FastAPI's bare 404 / 405), startPerfect() falls back to an
// in-browser mock job that is always labelled as a mock and never claims to
// have produced a repaired demo.

import { describeError, PmApiError } from "./api";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type Diagnoser = "rules" | "nemotron";

export interface Job {
  id: string;
  status: JobStatus;
  error: string | null;
  demoId: string | null; // the repaired demo, once there is one
  mock: boolean;
}

export interface JobsBackend {
  perfect(demoId: string, diagnoser: Diagnoser): Promise<unknown>;
  getJob(jobId: string): Promise<unknown>;
}

const STATUS: Record<string, JobStatus> = {
  queued: "queued",
  pending: "queued",
  running: "running",
  succeeded: "succeeded",
  success: "succeeded",
  done: "succeeded",
  completed: "succeeded",
  failed: "failed",
  error: "failed",
};

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function normalizeJob(input: unknown): Job {
  const raw = (input ?? {}) as Raw;
  const result = (raw.result ?? {}) as Raw;
  const rawStatus = String(raw.status ?? "");
  const status = STATUS[rawStatus.toLowerCase()];
  return {
    id: str(raw.id) ?? str(raw.job_id) ?? "",
    status: status ?? "failed",
    error: status ? str(raw.error) ?? str(raw.detail) : `Unknown job status "${rawStatus}"`,
    demoId: str(result.repaired_demo_id) ?? str(result.demo_id) ?? str(result.repaired_id),
    mock: raw.mock === true,
  };
}

export const isTerminal = (job: Job) => job.status === "succeeded" || job.status === "failed";

const MAX_ERRORS_IN_A_ROW = 3;

export interface PollOptions {
  intervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (job: Job) => void;
  signal?: AbortSignal;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until the job finishes, fails, times out (resolves a failed Job) or is aborted (resolves null). */
export async function pollJob(backend: JobsBackend, jobId: string, opts: PollOptions = {}): Promise<Job | null> {
  const { intervalMs = 1000, maxPolls = 600, sleep = realSleep, onUpdate, signal } = opts;
  const failed = (error: string): Job => ({ id: jobId, status: "failed", error, demoId: null, mock: false });
  let errors = 0;
  for (let poll = 0; poll < maxPolls; poll++) {
    if (signal?.aborted) return null;
    try {
      const job = normalizeJob(await backend.getJob(jobId));
      errors = 0;
      onUpdate?.(job);
      if (isTerminal(job)) return job;
    } catch (e) {
      errors += 1;
      if (errors >= MAX_ERRORS_IN_A_ROW) return failed(`Lost track of the job: ${describeError(e)}`);
    }
    if (signal?.aborted) return null;
    await sleep(intervalMs);
  }
  return failed(`Timed out after ${maxPolls} status checks; the job may still be running on the backend.`);
}

export interface StartedJob {
  jobId: string;
  mock: boolean;
  backend: JobsBackend;
}

export async function startPerfect(
  real: JobsBackend,
  mock: JobsBackend,
  demoId: string,
  diagnoser: Diagnoser,
): Promise<StartedJob> {
  try {
    const jobId = normalizeJob(await real.perfect(demoId, diagnoser)).id;
    return { jobId, mock: false, backend: real };
  } catch (e) {
    if (!(e instanceof PmApiError && e.kind === "route_missing")) throw e;
    const jobId = normalizeJob(await mock.perfect(demoId, diagnoser)).id;
    return { jobId, mock: true, backend: mock };
  }
}

/** A stand-in job for a backend without the route: queued, running, then succeeded, with no result. */
export function createMockJobs() {
  const polls = new Map<string, number>();
  let next = 0;
  return {
    async perfect(_demoId: string, _diagnoser: Diagnoser) {
      const job_id = `mock-${++next}`;
      polls.set(job_id, 0);
      return { job_id };
    },
    async getJob(jobId: string) {
      const n = (polls.get(jobId) ?? 0) + 1;
      polls.set(jobId, n);
      const status = n === 1 ? "queued" : n === 2 ? "running" : "succeeded";
      return { id: jobId, status, mock: true };
    },
  };
}
