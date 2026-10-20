import { describe, expect, it } from "vitest";
import { FRANKA_LIMITS, POSES, ROBOT_IDS, ROBOT_REACH, robotSpots, type RobotSpot } from "./forestRobots";
import { inCrack, logs, trees } from "./forestPlan";
import { walkXZ } from "./path";

const walk = walkXZ();
const toWalk = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
const forest = trees(220, 7, walk);
const fallen = logs(11, walk, forest, 5);
const spots = robotSpots(walk, forest, fallen);

describe("the robots lying in the moss (placeholders until the real GLBs)", () => {
  it("has a spot for every robot that is coming, and the half-buried gripper", () => {
    expect([...ROBOT_IDS]).toEqual(["franka", "so101", "piper", "openarm", "ur5e", "xarm"]);
    expect(new Set(spots.map((s) => s.id))).toEqual(new Set([...ROBOT_IDS, "franka_gripper"]));
  });

  it("puts each where the walk passes it, clear of the trunks, the logs, the crack and each other", () => {
    for (const s of spots) {
      const d = toWalk(s.x, s.z);
      expect(d).toBeGreaterThan(2.2);
      expect(d).toBeLessThan(8);
      expect(inCrack(s.x, s.z, -1.5)).toBe(false);
      for (const t of forest) expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThan(t.radius + s.footprint);
      for (const l of fallen) expect(Math.hypot(l.x - s.x, l.z - s.z)).toBeGreaterThan(l.length / 2 + s.footprint);
    }
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(spots[i].footprint + spots[j].footprint);
  });

  it("sizes each by its real reach (the Franka's 0.85 m is the reference), half buried", () => {
    const franka = spots.find((s) => s.id === "franka") as RobotSpot;
    for (const s of spots) {
      if (s.id === "franka_gripper") continue;
      expect(s.scale / franka.scale).toBeCloseTo(ROBOT_REACH[s.id as keyof typeof ROBOT_REACH] / ROBOT_REACH.franka, 6);
      expect(s.sink).toBeGreaterThanOrEqual(0.15);
      expect(s.sink).toBeLessThanOrEqual(0.6);
    }
  });

  it("poses the stand-in Franka within its joint limits, as a whole robot", () => {
    for (const s of spots) {
      const pose = POSES[s.pose];
      expect(pose).toBeDefined();
      for (const [j, v] of Object.entries(pose.joints)) {
        const [lo, hi] = FRANKA_LIMITS[j];
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
    expect(POSES[spots.find((s) => s.id === "franka_gripper")!.pose].only).toBe("hand");
    expect(spots.filter((s) => POSES[s.pose].only === undefined).length).toBeGreaterThanOrEqual(6);
  });

  it("is the same every visit", () => {
    expect(robotSpots(walk, forest, fallen)).toEqual(spots);
  });
});
