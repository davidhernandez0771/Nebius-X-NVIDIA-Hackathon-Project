import { describe, expect, it, vi } from "vitest";
import { fetchAnalysis, fetchSources, runAnalysis, type Fetch } from "./api";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("the analysis GETs", () => {
  it("load once per session per fetch, so /metrics and /analysis share them", async () => {
    const f = vi.fn(async () => ok({ live_enabled: false, sources: [] })) as unknown as Fetch;
    await Promise.all([fetchSources(f), fetchSources(f)]);
    await fetchSources(f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ask again after a failure", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 })).mockResolvedValue(ok({ id: "x" })) as unknown as Fetch;
    await expect(fetchAnalysis("x", f)).rejects.toThrow("HTTP 500");
    await expect(fetchAnalysis("x", f)).resolves.toEqual({ id: "x" });
  });

  it("are cleared by a live run", async () => {
    const f = vi.fn(async () => ok({ id: "x" })) as unknown as Fetch;
    await fetchAnalysis("x", f);
    await runAnalysis("x", f);
    await fetchAnalysis("x", f);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
