import { describe, expect, it, vi } from "vitest";
import type { Mesh } from "three";
import { loadTwinRobot } from "./loadTwinRobot";
import { readPublic } from "./testFiles";
const files = {
  urdf: "/robots/franka_description/robots/panda_arm_hand.urdf",
  packages: { franka_description: "/robots/franka_description" },
};

/** Serves web/public like the dev server; `missing` paths answer 404. */
function server(missing: string[] = []) {
  return vi.fn(async (url: string) => {
    if (missing.some((m) => url.endsWith(m))) return new Response("nope", { status: 404 });
    try {
      return new Response(await readPublic(url));
    } catch {
      return new Response("nope", { status: 404 });
    }
  });
}

const meshCount = (robot: { traverse: (cb: (o: unknown) => void) => void }) => {
  let n = 0;
  robot.traverse((o) => {
    if ((o as Mesh).isMesh) n += 1;
  });
  return n;
};

describe("loadTwinRobot", () => {
  it("loads the Franka's 11 collision meshes (the finger mesh twice) and none of the 10 MB visual ones", async () => {
    const fetchImpl = server();
    const loaded = await loadTwinRobot(files, fetchImpl as unknown as typeof fetch);
    expect(loaded.stick).toBe(false);
    expect(loaded.meshes).toEqual({ ok: 11, failed: [] });
    expect(meshCount(loaded.robot)).toBe(11);
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("/visual/"))).toBe(false);
    expect(urls).toContain("/robots/franka_description/meshes/collision/link4.stl");
  });

  it("falls back to the stick figure when a mesh doesn't load", async () => {
    const loaded = await loadTwinRobot(files, server(["link4.stl"]) as unknown as typeof fetch);
    expect(loaded.stick).toBe(true);
    expect(loaded.meshes.failed).toEqual(["/robots/franka_description/meshes/collision/link4.stl"]);
  });

  it("says so when the URDF itself is missing", async () => {
    await expect(loadTwinRobot(files, server(["panda_arm_hand.urdf"]) as unknown as typeof fetch)).rejects.toThrow(/HTTP 404/);
  });
});
