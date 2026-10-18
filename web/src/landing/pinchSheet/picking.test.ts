import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import {
  clampToSphere,
  clientToNdc,
  dragTarget,
  fitDistance,
  intersectRayPlane,
  pickParticle,
  rayFromNdc,
  type Ray,
} from "./picking";

function camera(z = 4, aspect = 1.6) {
  const cam = new PerspectiveCamera(30, aspect, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
const straight: Ray = { origin: [0, 0, 4], dir: [0, 0, -1] };

describe("clientToNdc", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  it("maps the element's corners and centre to -1..1, y up", () => {
    expect(clientToNdc({ x: 300, y: 150 }, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToNdc({ x: 100, y: 50 }, rect)).toEqual({ x: -1, y: 1 });
    expect(clientToNdc({ x: 500, y: 250 }, rect)).toEqual({ x: 1, y: -1 });
  });
  it("keeps going past the edges (a drag that leaves the canvas still tracks)", () => {
    expect(clientToNdc({ x: 700, y: 150 }, rect)!.x).toBeCloseTo(2); // one width past the right edge
  });
  it("returns null for a zero-size element", () => {
    expect(clientToNdc({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });
});

describe("rayFromNdc", () => {
  it("shoots from the camera through the screen point", () => {
    const r = rayFromNdc({ x: 0, y: 0 }, camera());
    expect(r.origin[2]).toBeCloseTo(4);
    expect(r.dir[0]).toBeCloseTo(0);
    expect(r.dir[1]).toBeCloseTo(0);
    expect(r.dir[2]).toBeCloseTo(-1);
  });
  it("a point right of centre lands right of the origin on the z = 0 plane, and the direction is unit", () => {
    const r = rayFromNdc({ x: 0.5, y: 0 }, camera());
    expect(Math.hypot(...r.dir)).toBeCloseTo(1);
    const hit = intersectRayPlane(r, [0, 0, 0], [0, 0, 1])!;
    expect(hit[0]).toBeGreaterThan(0);
    expect(hit[1]).toBeCloseTo(0);
    expect(hit[2]).toBeCloseTo(0);
  });
});

describe("pickParticle", () => {
  const pts = (...p: number[][]) => Float32Array.from(p.flat());

  it("picks the particle the ray passes closest to, within the radius", () => {
    expect(pickParticle(pts([0.5, 0, 0], [0.02, 0.01, 0], [-0.4, 0, 0]), straight, 0.1)).toBe(1);
  });
  it("returns -1 when nothing is within the radius", () => {
    expect(pickParticle(pts([0.5, 0, 0], [-0.4, 0, 0]), straight, 0.1)).toBe(-1);
  });
  it("on a folded sheet, takes the layer nearest the camera, not the one behind", () => {
    // index 0 is closer to the ray but behind; index 1 is on the fold in front
    expect(pickParticle(pts([0.0, 0.0, 0.0], [0.05, 0.0, 0.3]), straight, 0.1)).toBe(1);
    expect(pickParticle(pts([0.05, 0.0, 0.3], [0.0, 0.0, 0.0]), straight, 0.1)).toBe(0); // either order
  });
  it("ignores particles behind the camera", () => {
    expect(pickParticle(pts([0, 0, 5]), straight, 0.1)).toBe(-1);
  });
});

describe("intersectRayPlane", () => {
  it("hits a plane in front", () => {
    expect(intersectRayPlane(straight, [0, 0, 1], [0, 0, 1])).toEqual([0, 0, 1]);
  });
  it("misses a plane parallel to the ray or behind it", () => {
    expect(intersectRayPlane(straight, [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(intersectRayPlane(straight, [0, 0, 6], [0, 0, 1])).toBeNull();
  });
});

describe("clampToSphere", () => {
  it("leaves points inside alone and pulls points outside onto the surface", () => {
    expect(clampToSphere([0.1, 0, 0], [0, 0, 0], 1)).toEqual([0.1, 0, 0]);
    const p = clampToSphere([3, 4, 0], [0, 0, 0], 1);
    expect(p[0]).toBeCloseTo(0.6);
    expect(p[1]).toBeCloseTo(0.8);
  });
});

describe("dragTarget: where the held point should go", () => {
  const base = { planePoint: [0, 0, 0], towardCamera: [0, 0, 1], rest: [0, 0, 0] };

  it("follows the pointer on the plane it was grabbed on, lifted toward the camera like a pinch", () => {
    const ray: Ray = { origin: [0.3, 0.2, 4], dir: [0, 0, -1] };
    const t = dragTarget({ ...base, ray, lift: 0.15, maxPull: 2 })!;
    expect(t[0]).toBeCloseTo(0.3);
    expect(t[1]).toBeCloseTo(0.2);
    expect(t[2]).toBeCloseTo(0.15);
  });

  it("can't be pulled further than maxPull from where that bit of cloth rests", () => {
    const ray: Ray = { origin: [5, 0, 4], dir: [0, 0, -1] };
    const t = dragTarget({ ...base, ray, lift: 0, maxPull: 0.8 })!;
    expect(Math.hypot(...t)).toBeCloseTo(0.8);
  });

  it("returns null when the ray can't reach the drag plane", () => {
    const ray: Ray = { origin: [0, 0, 4], dir: [1, 0, 0] };
    expect(dragTarget({ ...base, ray, lift: 0.1, maxPull: 1 })).toBeNull();
  });
});

describe("fitDistance", () => {
  it("backs the camera off so the sheet plus margin fits the narrower axis", () => {
    // 30 deg vertical fov, square view: 1.5 tall with no margin needs 0.75 / tan(15 deg)
    expect(fitDistance(30, 1, 1, 1.5, 0)).toBeCloseTo(0.75 / Math.tan((15 * Math.PI) / 180));
    // a narrow view is limited by width instead
    const wide = fitDistance(30, 2, 2.4, 1.5, 0);
    const narrow = fitDistance(30, 0.8, 2.4, 1.5, 0);
    expect(narrow).toBeGreaterThan(wide);
    const halfW = (2.4 / 2) / (Math.tan((15 * Math.PI) / 180) * 0.8);
    expect(narrow).toBeCloseTo(halfW);
  });
  it("adds the margin around the sheet", () => {
    expect(fitDistance(30, 1, 1, 1, 0.5)).toBeCloseTo(1.5 * fitDistance(30, 1, 1, 1, 0));
  });
});
