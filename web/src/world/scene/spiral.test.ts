import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ITEMS } from "./items";
import { HELIX } from "./layout";
import { N_ITEMS, ROBOT_SLOTS, itemAtStep, itemInSlot, orderFor, resetSpiral, setFilter, spiral, stepCount, stepPose, stepSlot } from "./spiral";

afterEach(resetSpiral);

describe("the spiral's contents", () => {
  it("puts the jobs under the ceiling, top first, and the robots in the slots round them", () => {
    expect(HELIX[stepSlot(0)].position[1] + 1.25).toBeLessThan(14.4);
    expect(HELIX[stepSlot(0)].position[1]).toBeGreaterThan(HELIX[stepSlot(1)].position[1]);
    expect(ROBOT_SLOTS).toEqual([0, 1, 26, 27, 28]);
    expect(N_ITEMS + ROBOT_SLOTS.length).toBe(HELIX.length);
    expect(itemInSlot(stepSlot(0))).toBe(0);
    expect(itemInSlot(0)).toBe(-1);
    expect(itemInSlot(HELIX.length - 1)).toBe(-1);
  });

  it("slides a filter's matches to the top, in order, and limits the steps to them", () => {
    const order = orderFor("results");
    expect(order.slice(0, 4).map((i) => ITEMS[i].tag)).toEqual(["results", "results", "results", "results"]);
    expect(order).toHaveLength(N_ITEMS);
    setFilter("train");
    expect(stepCount()).toBe(4);
    expect(ITEMS[itemAtStep(0)].title).toBe("ACT 30K");
    expect(spiral.target[0]).toBe(4);
    setFilter(null);
    expect(stepCount()).toBe(N_ITEMS);
    expect(itemAtStep(0)).toBe(0);
  });
});

describe("stepPose", () => {
  it("lands on the helix slots at whole steps and stays between them otherwise", () => {
    const p = new THREE.Vector3();
    stepPose(3, p);
    expect(p.toArray()).toEqual([...HELIX[stepSlot(3)].position]);
    stepPose(3.5, p);
    const a = new THREE.Vector3(...HELIX[stepSlot(3)].position);
    const b = new THREE.Vector3(...HELIX[stepSlot(4)].position);
    expect(p.distanceTo(a.clone().lerp(b, 0.5))).toBeLessThan(1e-9);
  });
});
