import { beforeAll, describe, expect, it } from "vitest";
import URDFLoader from "urdf-loader";
import rows from "./fixtures/isaac_franka_rows.json";
import {
  ALIGN_RADIUS,
  alignState,
  fitOrtho,
  formatCm,
  glRect,
  GRID_HALF,
  gridBox,
  gridPoint,
  insideBin,
  isCarrying,
  rotate,
  squareCorners,
  toEnv,
  toolInEnv,
  viewLayout,
} from "./aids";
import { readPublic } from "./testFiles";
import type { QuatWxyz, TwinPose, Vec3 } from "./types";

const I: QuatWxyz = [1, 0, 0, 0];
const yaw = (deg: number): QuatWxyz => [Math.cos((deg * Math.PI) / 360), 0, 0, Math.sin((deg * Math.PI) / 360)];
const pose = (pos: Vec3, quat: QuatWxyz = I): TwinPose => ({ pos, quat });
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

// teleop_sink.py's scene: the cube starts at (0.5, 0), the bin at (0.5, 0.3)
const BIN = pose([0.5, 0.3, 0]);
const CUBE = pose([0.5, 0, 0.025]);

describe("frames", () => {
  it("rotates by a (w, x, y, z) quaternion", () => {
    close(rotate(I, [1, 2, 3]), [1, 2, 3]);
    close(rotate(yaw(90), [1, 0, 0]), [0, 1, 0]);
    close(rotate(yaw(180), [1, 2, 0.5]), [-1, -2, 0.5]);
  });

  it("puts a robot-frame point in the env frame (the Franka's base is the origin)", () => {
    expect(toEnv(null, [0.4, 0.1, 0.2])).toEqual([0.4, 0.1, 0.2]);
    close(toEnv(pose([0, 0, 0]), [0.4, 0.1, 0.2]), [0.4, 0.1, 0.2]);
    close(toEnv(pose([1, 2, 0.5], yaw(90)), [0.4, 0, 0]), [1, 2.4, 0.5]);
  });

  describe("the tool point from real recorded joints", () => {
    let urdf = "";
    beforeAll(async () => {
      urdf = new TextDecoder().decode(await readPublic("robots/franka_description/robots/panda_arm_hand.urdf"));
    });

    it("is where Isaac measured it (within 0.1 mm), shifted by the base", () => {
      const loader = new URDFLoader();
      loader.parseVisual = false;
      loader.parseCollision = false;
      const robot = loader.parse(urdf);
      for (const row of rows.rows) {
        const joints = Object.fromEntries(rows.joint_names.map((n, i) => [n, row.joint_pos[i]]));
        close(toolInEnv(robot, joints, null), row.ee_pos as Vec3, 4);
        const shifted = toolInEnv(robot, joints, pose([0.1, -0.2, 0.3]));
        close(shifted, [row.ee_pos[0] + 0.1, row.ee_pos[1] - 0.2, row.ee_pos[2] + 0.3], 4);
      }
    });
  });
});

describe("the bin and carrying", () => {
  it("counts a point over the bin's 0.2 x 0.2 m inner area, at any height", () => {
    expect(insideBin([0.5, 0.3, 0.2], BIN)).toBe(true);
    expect(insideBin([0.59, 0.39, 0.05], BIN)).toBe(true);
    expect(insideBin([0.61, 0.3, 0.05], BIN)).toBe(false);
    expect(insideBin([0.5, 0.41, 0.05], BIN)).toBe(false);
  });

  it("turns the inner area with the bin", () => {
    const turned = pose([0.5, 0.3, 0], yaw(45));
    expect(insideBin([0.5 + 0.13, 0.3, 0.1], turned)).toBe(true); // along the diagonal: inside up to 0.141
    expect(insideBin([0.5 + 0.09, 0.3 + 0.09, 0.1], turned)).toBe(false); // a corner of the unturned bin
  });

  it("is carrying when the gripper is closed with the cube at the tool point", () => {
    expect(isCarrying([0.5, 0, 0.03], [0.5, 0, 0.025], 1)).toBe(true);
    expect(isCarrying([0.5, 0, 0.03], [0.5, 0, 0.025], 0)).toBe(false); // open: just touching
    expect(isCarrying([0.5, 0, 0.03], [0.5, 0, 0.025], null)).toBe(false);
    expect(isCarrying([0.5, 0, 0.2], [0.5, 0, 0.025], 1)).toBe(false); // closed on nothing, above the cube
  });
});

describe("alignState", () => {
  it("has nothing to line up without a tool point or a cube", () => {
    expect(alignState(null, CUBE, BIN, 0)).toBeNull();
    expect(alignState([0.4, 0, 0.3], null, BIN, 0)).toBeNull();
  });

  it("aims at the cube while carrying nothing: target minus tool, in metres", () => {
    const a = alignState([0.45, 0.02, 0.3], CUBE, BIN, 0)!;
    expect(a.kind).toBe("cube");
    expect(a.target).toEqual([0.5, 0, 0.025]);
    expect(a.dx).toBeCloseTo(0.05);
    expect(a.dy).toBeCloseTo(-0.02);
    expect(a.aligned).toBe(false);
  });

  it("is aligned within ~1.5 cm of above the cube, at any height", () => {
    expect(alignState([0.51, 0.01, 0.3], CUBE, BIN, 0)!.aligned).toBe(true); // 1.41 cm
    expect(alignState([0.5 + ALIGN_RADIUS * 0.99, 0, 0.1], CUBE, BIN, 0)!.aligned).toBe(true);
    expect(alignState([0.5, 0.016, 0.1], CUBE, BIN, 0)!.aligned).toBe(false);
    // closed on nothing high above the cube: still aiming at the cube
    expect(alignState([0.5, 0, 0.3], CUBE, BIN, 1)!.kind).toBe("cube");
  });

  it("aims at the bin's centre while carrying, aligned once the carried cube is over the inner area", () => {
    const carried = pose([0.52, 0.12, 0.2]);
    const a = alignState([0.52, 0.12, 0.21], carried, BIN, 1)!;
    expect(a.kind).toBe("bin");
    expect(a.target).toEqual([0.5, 0.3, 0]);
    expect(a.dx).toBeCloseTo(-0.02);
    expect(a.dy).toBeCloseTo(0.18);
    expect(a.aligned).toBe(false);
    const over = pose([0.55, 0.38, 0.2]);
    expect(alignState([0.55, 0.38, 0.21], over, BIN, 1)!.aligned).toBe(true);
  });

  it("keeps the bin lit once the cube is put in it, the gripper open and away", () => {
    const placed = pose([0.52, 0.31, 0.035]);
    const a = alignState([0.5, 0.3, 0.25], placed, BIN, 0)!;
    expect(a.kind).toBe("bin");
    expect(a.aligned).toBe(true);
  });

  it("has no target while carrying with no bin", () => {
    expect(alignState([0.5, 0, 0.03], CUBE, null, 1)).toBeNull();
  });
});

describe("formatCm", () => {
  it("is signed centimetres to 0.1, with a real minus", () => {
    expect(formatCm(0.0234)).toBe("+2.3");
    expect(formatCm(-0.008)).toBe("−0.8");
    expect(formatCm(0.00004)).toBe("0.0");
    expect(formatCm(-0.00004)).toBe("0.0");
    expect(formatCm(0.25)).toBe("+25.0");
  });
});

describe("viewLayout", () => {
  it("puts the front view on top and side, top and the grid in a strip under it, with 1 px between", () => {
    const L = viewLayout(500, 400);
    expect(L.front).toEqual({ x: 0, y: 0, w: 500, h: 231 });
    expect(L.side.y).toBe(232);
    expect(L.side.h).toBe(168);
    expect(L.side.x).toBe(0);
    expect(L.top.x).toBe(L.side.x + L.side.w + 1);
    expect(L.align.x).toBe(L.top.x + L.top.w + 1);
    expect(L.align.x + L.align.w).toBe(500);
    for (const r of [L.side, L.top, L.align]) expect(Math.abs(r.w - 166)).toBeLessThanOrEqual(1);
  });

  it("never goes negative in a collapsed pane", () => {
    for (const r of Object.values(viewLayout(0, 0))) for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("flips a rect into WebGL's bottom-up viewport", () => {
    expect(glRect({ x: 10, y: 20, w: 100, h: 50 }, 400)).toEqual([10, 330, 100, 50]);
  });
});

describe("fitOrtho", () => {
  it("contains the region: a wide region fills a square view's width", () => {
    expect(fitOrtho(0.5, 0.25, 1)).toEqual({ halfW: 0.5, halfH: 0.5 });
  });
  it("and a tall region fills a wide view's height", () => {
    expect(fitOrtho(0.2, 0.4, 2)).toEqual({ halfW: 0.8, halfH: 0.4 });
  });
});

describe("the alignment grid", () => {
  const box = gridBox(180, 200); // plot: 162 px square (200 - 18 - 20), centred at (90, 99)

  it("fits a square plot between the tag and the readout", () => {
    expect(box.cx).toBe(90);
    expect(box.cy).toBe(99);
    expect(box.scale).toBeCloseTo(162 / (2 * GRID_HALF));
  });

  it("draws forward up and the robot's left on the left, centred on the target", () => {
    const c: Vec3 = [0.5, 0, 0];
    expect(gridPoint(c, c, box)).toEqual([90, 99]);
    const [, yFwd] = gridPoint([0.55, 0, 0], c, box);
    expect(yFwd).toBeLessThan(99);
    const [xLeft] = gridPoint([0.5, 0.05, 0], c, box);
    expect(xLeft).toBeLessThan(90);
  });

  it("clamps a far point to the plot's edge", () => {
    const [x, y] = gridPoint([2, -3, 0], [0.5, 0, 0], box);
    expect(y).toBeCloseTo(99 - 81);
    expect(x).toBeCloseTo(90 + 81);
    expect(gridPoint([2, 0, 0], [0.5, 0, 0], box, false)[1]).toBeLessThan(0);
  });

  it("turns a square's corners with its pose", () => {
    close(squareCorners(BIN, 0.1)[0], [0.6, 0.4, 0]);
    const turned = squareCorners(pose([0, 0, 0], yaw(90)), 0.1);
    close(turned[0], [-0.1, 0.1, 0]);
  });
});
