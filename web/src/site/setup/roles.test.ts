import { describe, expect, it } from "vitest";
import franka from "./fixtures/franka.parts.json";
import openarm from "./fixtures/openarm.parts.json";
import { accepts, assign, fromSuggested, localIssues, rolesOf, suggestedFor, toBody, treeRows, unassign } from "./roles";
import type { Parts } from "./types";

const panda = franka as unknown as Parts;
const oa = openarm as unknown as Parts;

describe("treeRows", () => {
  it("walks the tree from the root, links and joints interleaved; a serial chain stays at one depth", () => {
    const rows = treeRows(panda);
    expect(rows[0]).toMatchObject({ kind: "link", name: "panda_link0", depth: 0 });
    expect(rows[1]).toMatchObject({ kind: "joint", name: "panda_joint1", depth: 0 });
    expect(rows[2]).toMatchObject({ kind: "link", name: "panda_link1", depth: 0 });
    expect(rows).toHaveLength(panda.links.length + panda.joints.length);
  });

  it("indents where the tree branches and marks each branch's last row", () => {
    const rows = treeRows(panda);
    const fingers = rows.filter((r) => r.name.startsWith("panda_finger_joint"));
    expect(fingers.map((r) => r.depth)).toEqual([1, 1]);
    expect(fingers.map((r) => r.branchLast)).toEqual([false, true]);
    expect(rows[rows.length - 1]).toMatchObject({ name: "panda_rightfinger", depth: 1 });
  });

  it("knows which ancestor lanes continue past a row, and where each spine ends", () => {
    const rows = treeRows(panda);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.panda_leftfinger.guides).toEqual([true]);
    expect(byName.panda_rightfinger.guides).toEqual([false]);
    expect(byName.panda_hand.end).toBe(false); // the lane runs on to the finger elbows
    expect(byName.panda_rightfinger.end).toBe(true);
    expect(byName.panda_link3.end).toBe(false);
    expect(byName.panda_leftfinger.end).toBe(true);
  });
});

describe("accepts", () => {
  it("base and hand take links; arm takes revolute joints; gripper takes movable joints", () => {
    expect(accepts(panda, "base", "panda_link0")).toBe(true);
    expect(accepts(panda, "base", "panda_joint1")).toBe(false);
    expect(accepts(panda, "arm", "panda_joint4")).toBe(true);
    expect(accepts(panda, "arm", "panda_finger_joint1")).toBe(false);
    expect(accepts(panda, "gripper", "panda_finger_joint1")).toBe(true);
    expect(accepts(panda, "gripper", "panda_hand_joint")).toBe(false);
    expect(accepts(panda, "hand", "panda_hand")).toBe(true);
  });
});

describe("assign / unassign", () => {
  const empty = { base: null, arm_joints: [], hand: null, gripper_joints: [] };

  it("keeps arm joints in chain order from the base outwards", () => {
    let r = assign(panda, empty, "arm", "panda_joint3");
    r = assign(panda, r, "arm", "panda_joint1");
    expect(r.arm_joints).toEqual(["panda_joint1", "panda_joint3"]);
  });

  it("moves a joint between arm and gripper instead of overlapping", () => {
    const r = assign(panda, assign(panda, empty, "arm", "panda_joint7"), "gripper", "panda_joint7");
    expect(r.arm_joints).toEqual([]);
    expect(r.gripper_joints).toEqual(["panda_joint7"]);
  });

  it("replaces the base and the hand, and removes", () => {
    const r = assign(panda, assign(panda, empty, "hand", "panda_link7"), "hand", "panda_hand");
    expect(r.hand).toBe("panda_hand");
    expect(unassign(r, "hand", "panda_hand").hand).toBeNull();
    expect(unassign(fromSuggested(panda), "arm", "panda_joint2").arm_joints).not.toContain("panda_joint2");
  });

  it("rejects a part the role does not take", () => {
    expect(assign(panda, empty, "base", "panda_joint1")).toBe(empty);
  });
});

describe("rolesOf / suggestedFor", () => {
  it("reads a part's roles and whether they were suggested", () => {
    const r = fromSuggested(oa);
    expect(rolesOf(r, "openarm_joint6")).toEqual(["arm"]);
    expect(rolesOf(r, "openarm_link0")).toEqual(["base"]);
    expect(suggestedFor(oa, "openarm_joint6")).toEqual(["arm"]);
    expect(suggestedFor(oa, "openarm_hand")).toEqual([]);
  });
});

describe("localIssues", () => {
  it("is empty for the suggested roles", () => {
    expect(localIssues(fromSuggested(panda))).toEqual([]);
  });

  it("uses the backend's codes", () => {
    const r = { ...fromSuggested(panda), arm_joints: ["panda_joint1", "panda_joint2"], gripper_joints: [], hand: null };
    expect(localIssues(r).map((i) => i.code)).toEqual(["arm_too_short", "no_hand", "no_gripper"]);
  });
});

describe("toBody", () => {
  it("sends the four roles and the mount", () => {
    expect(toBody(fromSuggested(panda), [0.2, 0, 0.25])).toEqual({
      ...fromSuggested(panda),
      mount: { pos: [0.2, 0, 0.25] },
    });
  });
});
