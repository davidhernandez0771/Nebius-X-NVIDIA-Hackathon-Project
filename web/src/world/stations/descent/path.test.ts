import { describe, expect, it } from "vitest";
import { stop } from "../../scene/layout";
import { PORTAL_VIEW } from "../intro/storyPlan";
import { descentCamera, HUB_FAR, PUSH_AT } from "./path";

describe("the descent's camera", () => {
  it("starts on the ring, square on, where the intro ends", () => {
    expect(descentCamera(0)).toEqual(PORTAL_VIEW);
  });

  it("pushes into the burst first, then drops to just behind the room view", () => {
    const push = descentCamera(PUSH_AT);
    expect(push.position[2]).toBeLessThan(PORTAL_VIEW.position[2]);
    expect(descentCamera(1)).toEqual(HUB_FAR);
    const hub = stop("Workshop intro");
    expect(HUB_FAR.target).toEqual(hub.target);
    // Behind and above the room view, so the workshop's travel is a small push in.
    expect(HUB_FAR.position[2]).toBeGreaterThan(hub.position[2]);
    expect(HUB_FAR.position[1]).toBeGreaterThan(hub.position[1]);
  });

  it("never flies through the room: it stays in front of its open wall (z = 13)", () => {
    for (let t = 0; t <= 1; t += 0.01) expect(descentCamera(t).position[2]).toBeGreaterThan(13);
  });

  it("moves without a jump", () => {
    let prev = descentCamera(0);
    for (let t = 0.005; t <= 1; t += 0.005) {
      const p = descentCamera(t);
      expect(Math.hypot(...p.position.map((v, i) => v - prev.position[i]))).toBeLessThan(0.6);
      prev = p;
    }
  });
});
