import { describe, expect, it } from "vitest";
import { PmApiError, pmFetch, teleopSocketUrl } from "./api";

type FakeResponse = { status: number; body: string };

function fakeFetch(res: FakeResponse | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return new Response(res.body, { status: res.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function caught(p: Promise<unknown>): Promise<PmApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PmApiError) return e;
    throw e;
  }
  throw new Error("expected a PmApiError");
}

describe("pmFetch", () => {
  it("returns the parsed JSON body on success", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: '[{"id":"d1"}]' });
    await expect(pmFetch("/demos", undefined, impl, "http://api")).resolves.toEqual([{ id: "d1" }]);
    expect(calls[0].url).toBe("http://api/demos");
  });

  it("reports a network failure as an unreachable backend", async () => {
    const { impl } = fakeFetch(new TypeError("Failed to fetch"));
    const err = await caught(pmFetch("/demos", undefined, impl, "http://api"));
    expect(err.kind).toBe("unreachable");
    expect(err.status).toBe(0);
  });

  it("reports 503 as the sim worker being down and keeps FastAPI's detail", async () => {
    const { impl } = fakeFetch({ status: 503, body: '{"detail":"sim worker not running at http://127.0.0.1:8770"}' });
    const err = await caught(pmFetch("/demos/d1/perfect", { method: "POST" }, impl, "http://api"));
    expect(err.kind).toBe("sim_down");
    expect(err.detail).toBe("sim worker not running at http://127.0.0.1:8770");
  });

  it("tells a missing route (FastAPI's bare Not Found) apart from a missing demo", async () => {
    const route = await caught(pmFetch("/jobs/j1", undefined, fakeFetch({ status: 404, body: '{"detail":"Not Found"}' }).impl, ""));
    expect(route.kind).toBe("route_missing");
    const demo = await caught(
      pmFetch("/demos/x", undefined, fakeFetch({ status: 404, body: "{\"detail\":\"demo 'x' not found\"}" }).impl, ""),
    );
    expect(demo.kind).toBe("not_found");
  });

  it("treats 405 as a missing route", async () => {
    const err = await caught(pmFetch("/export", { method: "POST" }, fakeFetch({ status: 405, body: '{"detail":"Method Not Allowed"}' }).impl, ""));
    expect(err.kind).toBe("route_missing");
  });

  it("classifies 409, 422 and 500, using the raw text when the body is not JSON", async () => {
    const busy = await caught(pmFetch("/x", undefined, fakeFetch({ status: 409, body: '{"detail":"busy"}' }).impl, ""));
    expect(busy.kind).toBe("conflict");
    const bad = await caught(pmFetch("/x", undefined, fakeFetch({ status: 422, body: '{"detail":[{"msg":"bad"}]}' }).impl, ""));
    expect(bad.kind).toBe("invalid");
    const boom = await caught(pmFetch("/x", undefined, fakeFetch({ status: 500, body: "Internal Server Error" }).impl, ""));
    expect(boom.kind).toBe("server");
    expect(boom.detail).toBe("Internal Server Error");
  });
});

describe("teleopSocketUrl", () => {
  it("swaps http for ws and adds the browser role", () => {
    expect(teleopSocketUrl("http://localhost:8000")).toBe("ws://localhost:8000/ws/teleop?role=browser");
  });

  it("swaps https for wss and drops a trailing slash", () => {
    expect(teleopSocketUrl("https://example.org/")).toBe("wss://example.org/ws/teleop?role=browser");
  });
});
