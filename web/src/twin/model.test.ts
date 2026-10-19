import { beforeAll, describe, expect, it } from "vitest";
import URDFLoader from "urdf-loader";
import rows from "./fixtures/isaac_franka_rows.json";
import { applyJoints, binParts, boneSegments, FRANKA, matLines, quat, toolPoint } from "./model";
import { readPublic } from "./testFiles";

let urdf = "";
beforeAll(async () => {
  urdf = new TextDecoder().decode(await readPublic("robots/franka_description/robots/panda_arm_hand.urdf"));
});

function franka() {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  loader.parseCollision = false;
  return loader.parse(urdf);
}

describe("the vendored Franka URDF against the sim", () => {
  it("has every joint the sim streams, by the same names", () => {
    const robot = franka();
    for (const name of rows.joint_names) expect(robot.joints[name], name).toBeTruthy();
  });

  it("puts the tool where Isaac measured it, for real recorded joints (within 0.1 mm)", () => {
    const robot = franka();
    for (const row of rows.rows) {
      applyJoints(robot, Object.fromEntries(rows.joint_names.map((n, i) => [n, row.joint_pos[i]])));
      const p = toolPoint(robot);
      const err = Math.hypot(p.x - row.ee_pos[0], p.y - row.ee_pos[1], p.z - row.ee_pos[2]);
      expect(err, `step ${row.step}`).toBeLessThan(0.0001);
    }
  });

  it("starts in Isaac Lab's start pose, and ignores joints it doesn't have", () => {
    const robot = franka();
    expect(applyJoints(robot, FRANKA.rest)).toBe(true);
    expect(robot.joints.panda_joint4.angle).toBeCloseTo(-2.81);
    expect(applyJoints(robot, FRANKA.rest)).toBe(false); // nothing moved
    expect(applyJoints(robot, { not_a_joint: 1 })).toBe(false);
  });
});

describe("scene shapes", () => {
  it("builds the bin as the sim does: a 22 cm floor and 8 cm walls around a 20 cm inside", () => {
    const parts = binParts();
    expect(parts.map((p) => p.name)).toEqual(["floor", "wall_px", "wall_nx", "wall_py", "wall_ny"]);
    expect(parts[0].size[0]).toBeCloseTo(0.22);
    expect(parts[1].center[0]).toBeCloseTo(0.105);
    expect(parts[1].center[2]).toBeCloseTo(0.05);
    expect(parts[3].size).toEqual([0.2, 0.01, 0.08]);
  });

  it("rules the mat every 5 cm with a major line every 25 cm", () => {
    const lines = matLines();
    const xs = lines.filter((l) => l.a[0] === l.b[0]);
    expect(xs).toHaveLength(28); // -0.35 .. 1.00
    expect(xs.filter((l) => l.major).map((l) => +l.a[0].toFixed(2))).toEqual([-0.25, 0, 0.25, 0.5, 0.75, 1]);
    expect(lines.filter((l) => l.a[1] === l.b[1])).toHaveLength(25); // -0.6 .. 0.6
  });

  it("reads the sim's (w, x, y, z) quaternions", () => {
    const q = quat([Math.cos(0.15), 0, 0, Math.sin(0.15)]);
    expect([q.x, q.y, q.w]).toEqual([0, 0, Math.cos(0.15)]);
    expect(q.z).toBeCloseTo(Math.sin(0.15));
  });

  it("draws a bone to each child joint and a stub on each finger", () => {
    const bones = boneSegments(franka());
    expect(bones.filter((b) => b.link === "panda_link3")).toHaveLength(1);
    expect(bones.find((b) => b.link === "panda_link0")!.to.z).toBeCloseTo(0.333);
    expect(bones.filter((b) => b.link.endsWith("finger"))).toHaveLength(2);
  });
});
