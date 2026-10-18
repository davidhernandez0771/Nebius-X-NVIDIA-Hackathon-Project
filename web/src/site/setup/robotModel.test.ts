import { describe, expect, it } from "vitest";
import URDFLoader from "urdf-loader";
import franka from "./fixtures/franka.parts.json";
import openarm from "./fixtures/openarm.parts.json";
import { focusLinks, stickFigure, urdfFromParts } from "./robotModel";
import type { Parts } from "./types";

const panda = franka as unknown as Parts;
const oa = openarm as unknown as Parts;

describe("urdfFromParts", () => {
  it("rebuilds a URDF that urdf-loader parses into the same tree", () => {
    const robot = new URDFLoader().parse(urdfFromParts(panda));
    expect(Object.keys(robot.joints).sort()).toEqual(panda.joints.map((j) => j.name).sort());
    expect(Object.keys(robot.links).sort()).toEqual(panda.links.map((l) => l.name).sort());
    expect(robot.joints.panda_finger_joint2.jointType).toBe("prismatic");
  });

  it("escapes names", () => {
    const p = { ...panda, name: 'a"<b' };
    expect(urdfFromParts(p)).toContain('name="a&quot;&lt;b"');
  });
});

describe("focusLinks", () => {
  it("lights a link itself and a joint's child link", () => {
    expect(focusLinks(panda, "panda_link3")).toEqual(["panda_link3"]);
    expect(focusLinks(panda, "panda_joint4")).toEqual(["panda_link4"]);
    expect(focusLinks(panda, null)).toEqual([]);
    expect(focusLinks(panda, "nope")).toEqual([]);
  });
});

describe("stickFigure", () => {
  it("draws a capsule from each link's origin to its child joints, and a dot per joint", () => {
    const robot = new URDFLoader().parse(urdfFromParts(oa));
    const fig = stickFigure(robot);
    expect(fig.dots).toHaveLength(oa.joints.length);
    const link0 = fig.bones.find((b) => b.link === "openarm_link0")!;
    expect(link0.b.z).toBeCloseTo(0.0625, 4); // joint1 sits 62.5 mm above the base origin
    expect(fig.bones.every((b) => b.a.distanceTo(b.b) > 0.001)).toBe(true);
  });

  it("measures the figure so the camera can frame it", () => {
    const robot = new URDFLoader().parse(urdfFromParts(panda));
    const fig = stickFigure(robot);
    expect(fig.size).toBeGreaterThan(0.5);
  });
});
