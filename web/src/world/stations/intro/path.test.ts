import { describe, expect, it } from "vitest";
import { inCrack } from "./forestPlan";
import { CAVERN, CORE, FOREST, HERO_VIEW, LOGO, LOGO_R, ROCK, THE_RING } from "./layout";
import { cameraAt, PORTAL_VIEW, walkXZ } from "./path";
import { INTRO_VH, placeLights, span } from "./storyPlan";

const STEP = 0.005;
const each = (fn: (vh: number) => void, from = 0, to = INTRO_VH) => {
  for (let vh = from; vh <= to + 1e-9; vh += STEP) fn(vh);
};
const axisR = (p: readonly number[]) => Math.hypot(p[0] - CAVERN.axis[0], p[2] - CAVERN.axis[1]);
const deg = (r: number) => (r * 180) / Math.PI;

describe("the intro's camera: down through the places", () => {
  it("starts on the hero and ends on THE RING, where the descent takes over", () => {
    expect(cameraAt(0)).toEqual(HERO_VIEW);
    expect(cameraAt(INTRO_VH)).toEqual(PORTAL_VIEW);
    expect(cameraAt(INTRO_VH + 1)).toEqual(PORTAL_VIEW);
  });

  it("only ever goes down as the scroll goes on (and so only up when it comes back)", () => {
    let prev = cameraAt(0).position[1];
    each((vh) => {
      const y = cameraAt(vh).position[1];
      expect(y).toBeLessThanOrEqual(prev + 1e-9);
      prev = y;
    });
    expect(cameraAt(INTRO_VH).position[1]).toBeLessThan(HERO_VIEW.position[1] - 100);
  });

  it("moves without a jump", () => {
    let prev = cameraAt(0);
    each((vh) => {
      const p = cameraAt(vh);
      expect(Math.hypot(...p.position.map((v, i) => v - prev.position[i]))).toBeLessThan(0.6);
      expect(Math.hypot(...p.target.map((v, i) => v - prev.target[i]))).toBeLessThan(1.2);
      prev = p;
    });
  });

  it("never looks straight up or down (the camera's roll stays put)", () => {
    each((vh) => {
      const p = cameraAt(vh);
      const d = p.target.map((v, i) => v - p.position[i]);
      const fromVertical = deg(Math.atan2(Math.hypot(d[0], d[2]), Math.abs(d[1])));
      expect(fromVertical).toBeGreaterThan(2);
    });
  });

  it("sinks below the logo, and the logo is out of the frame before the forest", () => {
    const p = cameraAt(span("sink")[1]);
    expect(p.position[1]).toBeLessThan(LOGO[1] - 3 * LOGO_R);
    const view = p.target.map((v, i) => v - p.position[i]);
    const toLogo = LOGO.map((v, i) => v - p.position[i]);
    const cos = view.reduce((s, v, i) => s + v * toLogo[i], 0) / (Math.hypot(...view) * Math.hypot(...toLogo));
    expect(deg(Math.acos(cos))).toBeGreaterThan(p.fov / 2 + 10);
  });

  it("walks the forest floor at eye height while the problem is told", () => {
    each(
      (vh) => {
        const p = cameraAt(vh).position;
        expect(p[1]).toBeGreaterThan(FOREST.floor + 1.2);
        expect(p[1]).toBeLessThan(FOREST.floor + 4);
        expect(Math.hypot(p[0] - FOREST.center[0], p[2] - FOREST.center[1])).toBeLessThan(FOREST.radius - 8);
      },
      ...span("forest"),
    );
  });

  it("goes through the rock only down the crack", () => {
    let inRock = 0;
    each((vh) => {
      const p = cameraAt(vh).position;
      if (p[1] < ROCK.top && p[1] > ROCK.bottom) {
        inRock++;
        expect(inCrack(p[0], p[2], 0.6)).toBe(true);
      }
    });
    expect(inRock).toBeGreaterThan(20);
  });

  it("stays inside the cavern while the reactor powers up, clear of the core and above it", () => {
    each(
      (vh) => {
        const p = cameraAt(vh).position;
        expect(axisR(p)).toBeLessThan(CAVERN.radius - 4);
        expect(p[1]).toBeLessThan(CAVERN.ceiling - 1);
        expect(p[1]).toBeGreaterThan(CORE.top + 10);
        expect(axisR(p)).toBeGreaterThan(CORE.radius + 4);
      },
      span("reactor")[0] + 0.2,
      span("proof")[1],
    );
  });

  // intro-proof: the proof beats need the screen; the camera only drifts slowly round the powered core.
  it("drifts slowly round the core while the proof beats show, so the panels read over a calm scene", () => {
    const [a, b] = span("proof");
    let prev = cameraAt(a);
    let travelled = 0;
    each(
      (vh) => {
        const p = cameraAt(vh);
        travelled += Math.hypot(...p.position.map((v, i) => v - prev.position[i]));
        prev = p;
      },
      a,
      b,
    );
    // Under 1.5 m of camera travel per viewport of scroll (the reactor orbit covers about 6).
    expect(travelled / (b - a)).toBeLessThan(1.5);
    expect(travelled).toBeGreaterThan(1);
  });

  it("ends above THE RING looking down into it, the whole ring in view", () => {
    expect(PORTAL_VIEW.target).toEqual(THE_RING.center);
    const above = PORTAL_VIEW.position[1] - THE_RING.center[1];
    expect(above).toBeGreaterThan(0);
    const off = Math.hypot(PORTAL_VIEW.position[0] - THE_RING.center[0], PORTAL_VIEW.position[2] - THE_RING.center[2]);
    const dist = Math.hypot(above, off);
    expect(deg(Math.atan((THE_RING.radius + 1) / dist))).toBeLessThan(PORTAL_VIEW.fov / 2);
  });

  it("is only ever lit where it is: no place shows from another", () => {
    each((vh) => {
      const y = cameraAt(vh).position[1];
      const l = placeLights(vh);
      if (l.hero > 0) expect(y).toBeGreaterThan(FOREST.floor + FOREST.canopy);
      if (l.forest > 0) {
        expect(y).toBeLessThan(FOREST.floor + FOREST.canopy + 6);
        expect(y).toBeGreaterThan(ROCK.top - 2);
      }
      if (l.reactor > 0) expect(y).toBeLessThan(ROCK.bottom + 6);
    });
  });
});

describe("walkXZ: where the camera crosses the forest", () => {
  it("covers the camera's way from the canopy down to the crack, as points on the ground", () => {
    const pts = walkXZ();
    expect(pts.length).toBeGreaterThan(20);
    each((vh) => {
      const p = cameraAt(vh).position;
      if (p[1] > FOREST.floor + FOREST.canopy + 2 || p[1] < ROCK.top) return;
      const d = Math.min(...pts.map(([x, z]) => Math.hypot(x - p[0], z - p[2])));
      expect(d).toBeLessThan(0.8);
    });
  });
});
