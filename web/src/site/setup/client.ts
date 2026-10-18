// The setup page's backend: T2's /robots API (byor-api.md) when it answers, otherwise the recorded fixtures,
// which walk the same flow (upload → parts → roles → evaluate → polled progress → card).
import frankaParts from "./fixtures/franka.parts.json";
import frankaReport from "./fixtures/franka.report.json";
import frankaRoles from "./fixtures/franka.roles.json";
import frankaUpload from "./fixtures/franka.upload.json";
import openarmParts from "./fixtures/openarm.parts.json";
import openarmReport from "./fixtures/openarm.report.json";
import openarmRoles from "./fixtures/openarm.roles.json";
import openarmUpload from "./fixtures/openarm.upload.json";
import { localIssues, sameRoles, fromSuggested } from "./roles";
import { openZip } from "./zip";
import { findUrdf } from "./urdfFiles";
import {
  ByorError,
  type EvaluateResult,
  type Issue,
  type Parts,
  type ReportCard,
  type ReportResponse,
  type RolesBody,
  type RolesResult,
  type UploadResult,
} from "./types";

export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type Sample = "franka" | "openarm";

export type ByorClient = {
  mode: "live" | "fixture";
  upload(file: File): Promise<UploadResult>;
  parts(id: string): Promise<Parts>;
  putRoles(id: string, body: RolesBody): Promise<RolesResult>;
  evaluate(id: string, body?: { seed0?: number; n?: number }): Promise<EvaluateResult>;
  report(id: string): Promise<ReportResponse>;
};

const issue = (code: string, message: string, where: string | null = null): Issue => ({ code, severity: "error", message, where });

// --- live ----------------------------------------------------------------------------------------------------

async function toError(res: Response): Promise<ByorError> {
  const text = await res.text();
  try {
    const detail = JSON.parse(text).detail;
    if (Array.isArray(detail?.errors)) return new ByorError(res.status, detail.errors);
    if (typeof detail === "string") return new ByorError(res.status, [issue("http", detail)]);
  } catch {
    /* not JSON */
  }
  return new ByorError(res.status, [issue("http", `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`)]);
}

export function liveClient(base: string = API_BASE): ByorClient {
  async function call<T>(path: string, init?: RequestInit, retries = 0): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, init);
    } catch {
      // Local HTTP connections reset now and then (WinError 10054); idempotent calls get one retry.
      if (retries > 0) return call(path, init, retries - 1);
      throw new ByorError(0, [issue("offline", `The backend at ${base} isn't answering. Start it, then try again.`)]);
    }
    if (!res.ok) throw await toError(res);
    return res.json() as Promise<T>;
  }
  const jsonInit = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    mode: "live",
    upload(file) {
      const form = new FormData();
      form.append("file", file);
      return call<UploadResult>("/robots", { method: "POST", body: form });
    },
    parts: (id) => call<Parts>(`/robots/${id}/parts`, undefined, 1),
    putRoles: (id, body) => call<RolesResult>(`/robots/${id}/roles`, jsonInit("PUT", body), 1),
    evaluate: (id, body) => call<EvaluateResult>(`/robots/${id}/evaluate`, jsonInit("POST", body ?? {})),
    report: (id) => call<ReportResponse>(`/robots/${id}/report`, undefined, 1),
  };
}

/** Live if GET /robots answers within the timeout, else the fixtures. `?fixture=1` forces the fixtures. */
export async function pickClient(base: string = API_BASE, timeoutMs = 1500): Promise<ByorClient> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/robots`, { signal: ctrl.signal });
    if (res.ok) return liveClient(base);
  } catch {
    /* fall through */
  } finally {
    clearTimeout(timer);
  }
  return fixtureClient();
}

// --- fixtures --------------------------------------------------------------------------------------------------

type Recorded = { upload: UploadResult; parts: Parts; roles: RolesResult; report: ReportCard };

export const RECORDED: Record<Sample, Recorded> = {
  franka: {
    upload: frankaUpload as UploadResult,
    parts: frankaParts as unknown as Parts,
    roles: frankaRoles as unknown as RolesResult,
    report: frankaReport as unknown as ReportCard,
  },
  openarm: {
    upload: openarmUpload as UploadResult,
    parts: openarmParts as unknown as Parts,
    roles: openarmRoles as unknown as RolesResult,
    report: openarmReport as unknown as ReportCard,
  },
};

const byId = (id: string) => {
  const key = (Object.keys(RECORDED) as Sample[]).find((k) => RECORDED[k].upload.id === id);
  if (!key) throw new ByorError(404, [issue("not_found", `robot ${id} not found`)]);
  return RECORDED[key];
};

async function urdfText(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".zip")) return file.text();
  const zip = openZip(await file.arrayBuffer());
  const found = findUrdf(zip.names);
  if ("error" in found) throw new ByorError(400, [found.error]);
  return zip.text(found.path);
}

export function fixtureClient({ now = () => Date.now(), runMs = 9000 }: { now?: () => number; runMs?: number } = {}) {
  const started = new Map<string, number>();
  const ready = new Set<string>();

  const client = {
    mode: "fixture" as const,
    async sample(key: Sample): Promise<UploadResult> {
      return { ...RECORDED[key].upload, created: false };
    },
    async upload(file: File): Promise<UploadResult> {
      const name = /<robot[^>]*\sname\s*=\s*["']([^"']+)["']/.exec(await urdfText(file))?.[1] ?? "";
      const key = /openarm/i.test(name) ? "openarm" : /panda|franka/i.test(name) ? "franka" : null;
      if (!key)
        throw new ByorError(503, [
          issue(
            "fixture_unknown",
            `The backend isn't running, and the recorded robots are the Franka and the OpenArm only (this URDF is "${name || "unnamed"}"). Start the backend to set up this robot.`,
            "file",
          ),
        ]);
      return RECORDED[key].upload;
    },
    async parts(id: string): Promise<Parts> {
      return byId(id).parts;
    },
    async putRoles(id: string, body: RolesBody): Promise<RolesResult> {
      const rec = byId(id);
      const errors = localIssues(body, rec.parts);
      if (errors.length) throw new ByorError(422, errors);
      ready.add(id);
      if (sameRoles(fromSuggested(rec.parts), { base: body.base, arm_joints: body.arm_joints, hand: body.hand, gripper_joints: body.gripper_joints }))
        return rec.roles;
      const note: Issue = {
        code: "fixture_roles",
        severity: "warning",
        message: "Recorded data: the report card is the run with the suggested roles, not these.",
        where: null,
      };
      return { ...rec.roles, roles: { ...rec.roles.roles, ...body }, issues: [...rec.roles.issues, note] };
    },
    async evaluate(id: string): Promise<EvaluateResult> {
      byId(id);
      if (!ready.has(id)) throw new ByorError(409, [issue("roles_missing", "set the roles first")]);
      started.set(id, now());
      return { job_id: `fixture_${id}`, status: "queued", poll: `/jobs/fixture_${id}`, report: `/robots/${id}/report` };
    },
    async report(id: string): Promise<ReportResponse> {
      const rec = byId(id);
      const t0 = started.get(id);
      if (t0 === undefined) return { status: "none", progress: null, report: null, error: null };
      const f = (now() - t0) / runMs;
      if (f >= 1) return { status: "done", progress: null, report: rec.report, error: null };
      const total = rec.report.scenes.rows.length;
      if (f < 0.1) return { status: "running", progress: { stage: "convert", done: 0, total: 1 }, report: null, error: null };
      if (f < 0.2) return { status: "running", progress: { stage: "reach_map", done: 0, total: 1 }, report: null, error: null };
      const done = Math.min(total, Math.floor(((f - 0.2) / 0.8) * total));
      return { status: "running", progress: { stage: "pick_place", done, total }, report: null, error: null };
    },
  };
  return client satisfies ByorClient;
}

export type FixtureClient = ReturnType<typeof fixtureClient>;
