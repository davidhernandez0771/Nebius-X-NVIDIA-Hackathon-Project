import { describe, expect, it } from "vitest";
import { CATALOG, STATUS_LABEL, robotById, specLine } from "./catalog";

describe("the robots catalog", () => {
  it("lists the five robots SANT tests with, the Isaac-tested ones first", () => {
    expect(CATALOG.map((r) => r.id)).toEqual(["franka", "flexiv", "openarm", "so101", "piper"]);
    expect(CATALOG.map((r) => r.status)).toEqual(["tested", "tested", "tested", "planned", "planned"]);
  });

  it("says tested in Isaac or planned, nothing else", () => {
    expect(STATUS_LABEL).toEqual({ tested: "Tested in Isaac", planned: "Planned" });
  });

  it("only claims a sim result for a robot that ran in Isaac", () => {
    for (const r of CATALOG) {
      if (r.status === "planned") expect(r.result).toBeUndefined();
      else expect(r.result).toMatch(/\d+\/\d+/);
    }
  });

  it("names a source for every robot, and for every number it shows", () => {
    for (const r of CATALOG) {
      expect(r.sources.length).toBeGreaterThan(0);
      const shown = [r.maker, r.arm.reach, r.gripper, r.today, r.result].filter(Boolean).join(" ");
      if (/\d/.test(shown)) expect(r.sources.join(" ")).toMatch(/notes|sim_worker|urdf|package\.xml|catalog/i);
    }
  });

  it("leaves a field out when the repo doesn't have it (no payload anywhere; no reach for the planned arms)", () => {
    for (const r of CATALOG) expect(r.arm).not.toHaveProperty("payload");
    expect(robotById("so101").arm.reach).toBeUndefined();
    expect(robotById("piper").arm.reach).toBeUndefined();
  });

  it("keeps the repo's numbers", () => {
    expect(robotById("franka").arm.dof).toBe("7");
    expect(robotById("franka").arm.reach).toMatch(/0\.85 m/);
    expect(robotById("flexiv").arm.reach).toMatch(/0\.78 m/);
    expect(robotById("flexiv").result).toMatch(/9\/30/);
    expect(robotById("openarm").result).toMatch(/0\/30/);
    expect(robotById("so101").arm.dof).toBe("5 + jaw");
    expect(robotById("piper").arm.dof).toBe("6");
  });

  it("writes a short spec line from the fields it has", () => {
    expect(specLine(robotById("franka"))).toBe("DoF 7 · reach ≈ 0.85 m");
    expect(specLine(robotById("so101"))).toBe("DoF 5 + jaw");
  });

  it("throws on an unknown robot", () => {
    expect(() => robotById("nope")).toThrow(/no robot/);
  });
});
