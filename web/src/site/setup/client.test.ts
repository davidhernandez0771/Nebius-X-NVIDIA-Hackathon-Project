import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureClient, liveClient, pickClient } from "./client";
import { fromSuggested } from "./roles";
import { ByorError } from "./types";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("liveClient", () => {
  it("turns a 422 body into a ByorError with the issue list", async () => {
    const errors = [{ code: "arm_too_short", severity: "error", message: "the arm has 4 DOF", where: "arm_joints" }];
    vi.stubGlobal("fetch", vi.fn(async () => json(422, { detail: { errors } })));
    const err = await liveClient("http://x").putRoles("byor_1", fromSuggested({ suggested_roles: {} } as never)).catch((e) => e);
    expect(err).toBeInstanceOf(ByorError);
    expect(err.status).toBe(422);
    expect(err.errors).toEqual(errors);
  });

  it("retries a GET once when the connection resets", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json(200, { status: "none" }));
    vi.stubGlobal("fetch", fetch);
    expect(await liveClient("http://x").report("byor_1")).toEqual({ status: "none" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("says the backend is not answering when it is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await liveClient("http://x").parts("byor_1").catch((e) => e);
    expect(err).toBeInstanceOf(ByorError);
    expect(err.errors[0].code).toBe("offline");
  });
});

describe("pickClient", () => {
  it("uses the live backend when GET /robots answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));
    expect((await pickClient("http://x")).mode).toBe("live");
  });

  it("falls back to the fixtures when it does not", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await pickClient("http://x")).mode).toBe("fixture");
  });
});

describe("fixtureClient", () => {
  it("recognizes the recorded robots by the URDF's robot name", async () => {
    const c = fixtureClient();
    const file = new File(['<robot name="openarm"><link name="a"/></robot>'], "openarm.urdf");
    expect((await c.upload(file)).id).toBe("byor_790916a678");
    const other = new File(['<robot name="so101"/>'], "so101.urdf");
    const err = await c.upload(other).catch((e) => e);
    expect(err.errors[0].code).toBe("fixture_unknown");
  });

  it("returns parts, accepts the suggested roles and rejects a short arm with the backend's codes", async () => {
    const c = fixtureClient();
    const { id } = await c.sample("franka");
    const parts = await c.parts(id);
    expect(parts.name).toBe("panda");
    expect((await c.putRoles(id, fromSuggested(parts))).ready).toBe(true);
    const err = await c.putRoles(id, { ...fromSuggested(parts), arm_joints: ["panda_joint1"] }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.errors[0].code).toBe("arm_too_short");
  });

  it("runs through the stages to the recorded card", async () => {
    let t = 0;
    const c = fixtureClient({ now: () => t, runMs: 1000 });
    const { id } = await c.sample("openarm");
    expect((await c.report(id)).status).toBe("none");
    await c.putRoles(id, fromSuggested(await c.parts(id)));
    await c.evaluate(id);
    t = 50;
    expect((await c.report(id)).progress?.stage).toBe("convert");
    t = 600;
    const mid = await c.report(id);
    expect(mid).toMatchObject({ status: "running", progress: { stage: "pick_place" } });
    t = 1001;
    const done = await c.report(id);
    expect(done.status).toBe("done");
    expect(done.report?.pick_place.successes).toMatchObject({ value: 0, of: 30 });
  });
});
