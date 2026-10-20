import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { wreckGeometry } from "./robotWrecks";
import type { RobotSpot } from "./forestRobots";

/** A stand-in URDF robot: a base link (a 0.2 m box), an arm link 0.5 m up (a 0.1 x 0.1 x 0.6 box along z), and a
 *  hand with a finger, each link holding one collider mesh, as urdf-loader builds them. */
function stubRobot() {
  const link = (name: string, size: [number, number, number], at: [number, number, number]) => {
    const l = new THREE.Object3D() as THREE.Object3D & { isURDFLink: boolean };
    l.name = name;
    l.isURDFLink = true;
    l.position.set(...at);
    const collider = new THREE.Object3D();
    collider.add(new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial()));
    l.add(collider);
    return l;
  };
  const root = new THREE.Object3D();
  const base = link("panda_link0", [0.2, 0.2, 0.2], [0, 0, 0]);
  const arm = link("panda_link1", [0.1, 0.1, 0.6], [0, 0, 0.5]);
  const hand = link("panda_hand", [0.15, 0.05, 0.05], [0, 0, 0.4]);
  const finger = link("panda_leftfinger", [0.02, 0.02, 0.05], [0, 0, 0.06]);
  root.add(base);
  base.add(arm);
  arm.add(hand);
  hand.add(finger);
  const set: Record<string, number> = {};
  const robot = Object.assign(root, {
    links: { panda_link0: base, panda_link1: arm, panda_hand: hand, panda_leftfinger: finger },
    joints: { panda_joint1: { setJointValue: (v: number) => (set.panda_joint1 = v) } },
  });
  return { robot: robot as unknown as URDFRobot, set };
}

const spot = (over: Partial<RobotSpot>): RobotSpot => ({ id: "franka", pose: "lying_side", x: 2, z: -3, yaw: 0, scale: 1, sink: 0.3, footprint: 1, ...over });

describe("the robots lying in the moss, as geometry", () => {
  it("sinks each body into the moss by its fraction, at its spot", () => {
    const { robot, set } = stubRobot();
    const g = wreckGeometry(robot, [spot({})], 100);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const h = b.max.y - b.min.y;
    expect(b.min.y).toBeCloseTo(100 - 0.3 * h, 5);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(2, 1);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(-3, 1);
    expect(set.panda_joint1).toBe(0); // the pose's joints were applied
  });

  it("keeps only the hand for a gripper pose", () => {
    const { robot } = stubRobot();
    const whole = wreckGeometry(robot, [spot({})], 0);
    const hand = wreckGeometry(robot, [spot({ id: "franka_gripper", pose: "gripper_buried" })], 0);
    // The stand-in's hand and finger are 2 of its 4 links.
    expect(hand.attributes.position.count).toBe(whole.attributes.position.count / 2);
    hand.computeBoundingBox();
    expect(hand.boundingBox!.getSize(new THREE.Vector3()).length()).toBeLessThan(0.4);
  });

  it("carries each link's own z in uv.x, for the panel seams, and merges every spot into one geometry", () => {
    const { robot } = stubRobot();
    const g = wreckGeometry(robot, [spot({}), spot({ x: 6, pose: "slumped" })], 0);
    const uv = g.attributes.uv;
    let span = 0;
    for (let i = 0; i < uv.count; i++) span = Math.max(span, Math.abs(uv.getX(i)));
    expect(span).toBeCloseTo(0.3, 5); // the arm's box runs ±0.3 along its link's z
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeGreaterThan(5);
  });
});
