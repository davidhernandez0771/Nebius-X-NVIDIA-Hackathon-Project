import { describe, expect, it } from "vitest";
import { CATALOG, STATUS_LABEL, WALL_ONLY, robotById, specLine } from "./catalog";

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

  it("leaves a field out when the sources don't have it: no payload anywhere (none of the repos states one)", () => {
    for (const r of CATALOG) expect(r.arm).not.toHaveProperty("payload");
  });

  it("takes DoF, reach and joint limits from each robot's own URDF chain where it was downloaded", () => {
    // specs.json: scripts/robot_asset_manifest.py over C:/dev/assets/robots (franka_description, SO-ARM100,
    // piper_ros, openarm_description at pinned commits).
    expect(robotById("franka").arm.reach).toBe("0.86 m");
    expect(robotById("so101").arm.reach).toBe("0.31 m");
    expect(robotById("piper").arm.reach).toBe("0.63 m");
    expect(robotById("openarm").arm.reach).toBe("0.44 m");
    expect(robotById("franka").limits?.map((l) => l.joint)).toEqual(["joint1", "joint2", "joint3", "joint4", "joint5", "joint6", "joint7"]);
    expect(robotById("franka").limits?.[3].range).toBe("-176° to -4°");
    expect(robotById("piper").limits).toHaveLength(6);
    // The Flexiv wasn't downloaded: its numbers stay the notes' (no URDF limits).
    expect(robotById("flexiv").arm.reach).toMatch(/0\.78 m/);
    expect(robotById("flexiv").limits).toBeUndefined();
    for (const id of ["franka", "so101", "piper", "openarm"]) expect(robotById(id).sources.join(" ")).toMatch(/@[0-9a-f]{7}/);
  });

  it("keeps the repo's numbers", () => {
    expect(robotById("franka").arm.dof).toBe("7");
    expect(robotById("flexiv").arm.reach).toMatch(/0\.78 m/);
    expect(robotById("flexiv").result).toMatch(/9\/30/);
    expect(robotById("openarm").result).toMatch(/0\/30/);
    expect(robotById("so101").arm.dof).toBe("5 + jaw");
    expect(robotById("piper").arm.dof).toBe("6");
  });

  it("writes a short spec line from the fields it has", () => {
    expect(specLine(robotById("franka"))).toBe("DoF 7 · reach 0.86 m");
    expect(specLine(robotById("so101"))).toBe("DoF 5 + jaw · reach 0.31 m");
  });

  it("says what stands on the wall for each robot: its maker's meshes with their repo and licence, or a stand-in", () => {
    expect(robotById("franka").model).toBe("Its maker's published meshes: frankarobotics/franka_description@7aeeddc, Apache-2.0.");
    expect(robotById("so101").model).toContain("TheRobotStudio/SO-ARM100@a758567, Apache-2.0");
    expect(robotById("openarm").model).toContain("enactic/openarm_description@206eb8a, Apache-2.0");
    // SOURCES.md: the repo's LICENSE is MIT, its package.xml says BSD.
    expect(robotById("piper").model).toContain("agilexrobotics/piper_ros@ac41fcb, MIT (its package.xml says BSD)");
    expect(robotById("flexiv").model).toMatch(/^A simple stand-in/);
  });

  it("lists the arms on the wall that SANT hasn't run, from their URDFs, without a status", () => {
    expect(WALL_ONLY.map((r) => r.id)).toEqual(["fr3", "ur5e", "xarm6"]);
    const ur = WALL_ONLY.find((r) => r.id === "ur5e")!;
    expect(ur.name).toBe("Universal Robots UR5e");
    expect(ur.spec).toBe("DoF 6 · reach 0.97 m");
    expect(ur.model).toContain("UniversalRobots/Universal_Robots_ROS2_Description@d4042c1, BSD-3-Clause");
    for (const r of WALL_ONLY) expect(CATALOG.map((x) => x.id)).not.toContain(r.id);
  });

  it("throws on an unknown robot", () => {
    expect(() => robotById("nope")).toThrow(/no robot/);
  });
});
