import { describe, expect, it } from "vitest";
import { PmApiError } from "./api";
import { createMockJobs, normalizeJob, pollJob, startPerfect, type Job, type JobsBackend } from "./jobs";

const noSleep = async () => {};

describe("normalizeJob", () => {
  it("accepts id or job_id", () => {
    expect(normalizeJob({ id: "j1", status: "running" }).id).toBe("j1");
    expect(normalizeJob({ job_id: "j2", status: "running" }).id).toBe("j2");
  });

  it.each([
    ["queued", "queued"],
    ["pending", "queued"],
    ["running", "running"],
    ["succeeded", "succeeded"],
    ["done", "succeeded"],
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["error", "failed"],
  ])("maps status %s to %s", (raw, want) => {
    expect(normalizeJob({ id: "j", status: raw }).status).toBe(want);
  });

  it("fails an unknown status loudly instead of polling it forever", () => {
    const job = normalizeJob({ id: "j", status: "exploded" });
    expect(job.status).toBe("failed");
    expect(job.error).toContain("exploded");
  });

  it("picks the repaired demo id from the result", () => {
    expect(normalizeJob({ id: "j", status: "done", result: { repaired_demo_id: "r1" } }).demoId).toBe("r1");
    expect(normalizeJob({ id: "j", status: "done", result: { demo_id: "r2" } }).demoId).toBe("r2");
    expect(normalizeJob({ id: "j", status: "done" }).demoId).toBeNull();
  });

  it("keeps the error message of a failed job", () => {
    expect(normalizeJob({ id: "j", status: "failed", error: "sim worker crashed" }).error).toBe("sim worker crashed");
  });
});

function scripted(statuses: (string | Error)[]): JobsBackend & { polls: number } {
  const backend = {
    polls: 0,
    async perfect() {
      return { job_id: "j1" };
    },
    async getJob() {
      const next = statuses[Math.min(backend.polls, statuses.length - 1)];
      backend.polls += 1;
      if (next instanceof Error) throw next;
      return { id: "j1", status: next };
    },
  };
  return backend;
}

describe("pollJob", () => {
  it("polls until the job finishes and reports every update", async () => {
    const backend = scripted(["queued", "running", "running", "succeeded"]);
    const seen: string[] = [];
    const job = await pollJob(backend, "j1", { sleep: noSleep, onUpdate: (j) => seen.push(j.status) });
    expect(job?.status).toBe("succeeded");
    expect(seen).toEqual(["queued", "running", "running", "succeeded"]);
    expect(backend.polls).toBe(4);
  });

  it("stops at a failed job", async () => {
    const backend = scripted(["running", "failed", "running"]);
    const job = await pollJob(backend, "j1", { sleep: noSleep });
    expect(job?.status).toBe("failed");
    expect(backend.polls).toBe(2);
  });

  it("rides out a single dropped poll", async () => {
    const unreachable = new PmApiError(0, "unreachable", "Failed to fetch");
    const backend = scripted(["running", unreachable, "succeeded"]);
    const job = await pollJob(backend, "j1", { sleep: noSleep });
    expect(job?.status).toBe("succeeded");
  });

  it("fails with the backend's message after three errors in a row", async () => {
    const down = new PmApiError(0, "unreachable", "Failed to fetch");
    const backend = scripted([down, down, down, "succeeded"]);
    const job = await pollJob(backend, "j1", { sleep: noSleep });
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/backend/i);
    expect(backend.polls).toBe(3);
  });

  it("gives up after maxPolls instead of hanging", async () => {
    const backend = scripted(["running"]);
    const job = await pollJob(backend, "j1", { sleep: noSleep, maxPolls: 5 });
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/timed out/i);
    expect(backend.polls).toBe(5);
  });

  it("stops polling when aborted", async () => {
    const backend = scripted(["running"]);
    const ctrl = new AbortController();
    const job = await pollJob(backend, "j1", {
      sleep: noSleep,
      signal: ctrl.signal,
      onUpdate: () => backend.polls === 2 && ctrl.abort(),
    });
    expect(job).toBeNull();
    expect(backend.polls).toBe(2);
  });
});

describe("startPerfect", () => {
  it("uses the real backend when the route exists", async () => {
    const calls: string[] = [];
    const real: JobsBackend = {
      async perfect(id, diagnoser) {
        calls.push(`${id}:${diagnoser}`);
        return { job_id: "real-1" };
      },
      async getJob() {
        return { id: "real-1", status: "running" };
      },
    };
    const started = await startPerfect(real, createMockJobs(), "d1", "rules");
    expect(started).toMatchObject({ jobId: "real-1", mock: false });
    expect(calls).toEqual(["d1:rules"]);
  });

  it("falls back to a labelled mock only when the route is missing", async () => {
    const missing: JobsBackend = {
      async perfect() {
        throw new PmApiError(404, "route_missing", "Not Found");
      },
      async getJob() {
        throw new Error("unused");
      },
    };
    const started = await startPerfect(missing, createMockJobs(), "d1", "rules");
    expect(started.mock).toBe(true);
  });

  it("does not hide a real error behind the mock", async () => {
    const down: JobsBackend = {
      async perfect() {
        throw new PmApiError(503, "sim_down", "sim worker not running");
      },
      async getJob() {
        throw new Error("unused");
      },
    };
    await expect(startPerfect(down, createMockJobs(), "d1", "rules")).rejects.toMatchObject({ kind: "sim_down" });
  });
});

describe("createMockJobs", () => {
  it("walks queued, running, succeeded and never claims a repaired demo", async () => {
    const mock = createMockJobs();
    const { job_id } = await mock.perfect("d1", "rules");
    const seen: Job[] = [];
    const job = await pollJob(mock, job_id, { sleep: noSleep, onUpdate: (j) => seen.push(j) });
    expect(seen.map((j) => j.status)).toEqual(["queued", "running", "succeeded"]);
    expect(job?.demoId).toBeNull();
    expect(job?.mock).toBe(true);
  });
});
