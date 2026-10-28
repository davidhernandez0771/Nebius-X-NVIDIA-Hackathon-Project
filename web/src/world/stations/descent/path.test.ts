import { describe, expect, it } from "vitest";
import { stop } from "../../scene/layout";
import { THE_RING } from "../intro/layout";
import { PORTAL_VIEW } from "../intro/path";
import { descentCamera, HUB_FAR, PUSH_AT } from "./path";

const axisR = (p: readonly number[]) => Math.hypot(p[0] - THE_RING.center[0], p[2] - THE_RING.center[2]);

describe("the descent's camera", () => {
  it("starts above THE RING, where the intro ends", () => {
    expect(descentCamera(0)).toEqual(PORTAL_VIEW);
  });

  it("dives down through the ring's opening, not its tube", () => {
    let crossed = false;
    let prev = descentCamera(0);
    for (let t = 0.001; t <= 1; t += 0.001) {
      const p = descentCamera(t);
      if (prev.position[1] >= THE_RING.center[1] && p.position[1] < THE_RING.center[1]) {
        crossed = true;
        expect(axisR(p.position)).toBeLessThan(THE_RING.radius * 0.5);
        expect(t).toBeLessThan(PUSH_AT);
      }
      prev = p;
    }
    expect(crossed).toBe(true);
    expect(descentCamera(PUSH_AT).position[1]).toBeLessThan(THE_RING.center[1] - 3);
  });

  it("then drops to just behind the room view", () => {
    expect(descentCamera(1)).toEqual(HUB_FAR);
    const hub = stop("Workshop intro");
    expect(HUB_FAR.target).toEqual(hub.target);
    // Behind and above the room view, so the workshop's travel is a small push in.
    expect(HUB_FAR.position[2]).toBeGreaterThan(hub.position[2]);
    expect(HUB_FAR.position[1]).toBeGreaterThan(hub.position[1]);
  });

  it("only goes down, and never flies through the room: it stays in front of its open wall (z = 13)", () => {
    let prevY = Infinity;
    for (let t = 0; t <= 1; t += 0.005) {
      const p = descentCamera(t).position;
      expect(p[2]).toBeGreaterThan(13);
      expect(p[1]).toBeLessThanOrEqual(prevY + 1e-9);
      prevY = p[1];
    }
  });

  it("moves without a jump, and never looks straight down", () => {
    let prev = descentCamera(0);
    for (let t = 0.005; t <= 1; t += 0.005) {
      const p = descentCamera(t);
      expect(Math.hypot(...p.position.map((v, i) => v - prev.position[i]))).toBeLessThan(1);
      const d = p.target.map((v, i) => v - p.position[i]);
      expect(Math.hypot(d[0], d[2]) / Math.abs(d[1])).toBeGreaterThan(Math.tan((2 * Math.PI) / 180));
      prev = p;
    }
  });
});
