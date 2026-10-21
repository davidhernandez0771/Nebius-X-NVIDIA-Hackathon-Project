// The Record page's per-frame hand -> message chain (handControl.ts), replayed over debug-trace frames: pinching
// leaves depth alone, the spacebar can drive the gripper, sensitivity scales motion, and the clutch freezes the
// target and lets go without a jump.

import { describe, expect, it } from "vitest";
import type { TrackedHand } from "../../hand/contracts";
import { toTarget } from "../../site/record-hud/hudModel";
import { pinchTraceFrames, STILL_PINCHES, type PinchPlan } from "./__fixtures__/pinchTrace";
import { DEFAULT_TELEOP_CONTROL, reachFromNeutral, type TeleopControlSettings } from "./controlRegion";
import type { TraceFrame } from "./debugTrace";
import { HandControl, type ControlInput } from "./handControl";
import { toHandPoseMsg, type HandPoseMsg } from "./handPoseMessage";
import { stableSize } from "./depthSignal";

const handOf = (f: TraceFrame): TrackedHand | null =>
  f.landmarks
    ? {
        landmarks: f.landmarks.map(([x, y, z]) => ({ x, y, z })),
        worldLandmarks: f.world ? f.world.map(([x, y, z]) => ({ x, y, z })) : undefined,
        handedness: f.handedness === "Right" ? "Right" : "Left",
      }
    : null;
const info = (f: TraceFrame) => ({ timestamp: f.t, frameWidth: f.frame[0], frameHeight: f.frame[1] });
const OPEN: ControlInput = { clutch: false, spaceGripper: 0 };

/** The settings a session would have after auto-centering reach on the trace's first frame. */
function centred(frames: TraceFrame[], patch: Partial<TeleopControlSettings> = {}): TeleopControlSettings {
  const f = frames[0];
  const size = stableSize(handOf(f)!.landmarks, f.frame[0], f.frame[1])!;
  return { ...DEFAULT_TELEOP_CONTROL, ...reachFromNeutral(size), ...patch };
}

type Run = { t: number; x: number; y: number; z: number; gripper: 0 | 1; msg: HandPoseMsg }[];

function replay(frames: TraceFrame[], s: TeleopControlSettings, input: (t: number) => ControlInput = () => OPEN): Run {
  const control = new HandControl();
  return frames.map((f) => {
    const out = control.step(handOf(f), info(f), s, input(f.t));
    const [x, y, z] = toTarget(out.msg).ee;
    return { t: f.t, x, y, z, gripper: out.gripper, msg: out.msg };
  });
}

/** The old chain: depth from the pixel palm width |lm5 - lm17|, nothing re-anchored. */
function replayPalmWidth(frames: TraceFrame[], s: TeleopControlSettings): number[] {
  let last: HandPoseMsg | undefined;
  return frames.map((f) => {
    last = toHandPoseMsg(handOf(f), info(f), last, s);
    return toTarget(last).ee[0];
  });
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const CM = 0.01;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The depth (x) level of each open and each pinched phase of a plan: medians, skipping 300 ms at each end. */
function levels(run: Run, p: PinchPlan): number[] {
  const cycle = p.openMs + 2 * p.closeMs + p.holdMs;
  const phases: [number, number][] = [];
  for (let k = 0; k <= p.pinches; k++) {
    phases.push([k * cycle, k * cycle + p.openMs]);
    if (k < p.pinches) phases.push([k * cycle + p.openMs + p.closeMs, k * cycle + p.openMs + p.closeMs + p.holdMs]);
  }
  return phases.map(([a, b]) => median(run.filter((r) => r.t >= a + 300 && r.t < b - 300).map((r) => r.x)));
}

describe("pinching a still hand (A: the depth jump)", () => {
  const frames = pinchTraceFrames();

  it("reproduces the jump with the old palm-width depth: the arm pulls back on every pinch", () => {
    const palmCentred = { ...centred(frames), ...reachFromNeutral(toHandPoseMsg(handOf(frames[0]), info(frames[0])).palm_width) };
    const xs = replayPalmWidth(frames, palmCentred);
    expect(spread(xs)).toBeGreaterThan(4 * CM);
    expect(Math.min(...xs)).toBeLessThan(xs[0] - 4 * CM); // back, not forward
  });

  it("closes and opens the gripper 4 times while the depth level stays within 1 cm of where it started", () => {
    const run = replay(frames, centred(frames));
    const closes = run.filter((r, i) => i > 0 && r.gripper === 1 && run[i - 1].gripper === 0).length;
    const opens = run.filter((r, i) => i > 0 && r.gripper === 0 && run[i - 1].gripper === 1).length;
    expect([closes, opens]).toEqual([4, 4]);
    const lv = levels(run, STILL_PINCHES); // open, pinched, open, ... (9 phases)
    expect(lv).toHaveLength(9);
    for (const l of lv) expect(Math.abs(l - lv[0])).toBeLessThan(1 * CM);
  });

  it("the old palm-width levels move by several cm on the same trace (what the fix removes)", () => {
    const palmCentred = { ...centred(frames), ...reachFromNeutral(toHandPoseMsg(handOf(frames[0]), info(frames[0])).palm_width) };
    const xs = replayPalmWidth(frames, palmCentred);
    const lv = levels(xs.map((x, i) => ({ t: frames[i].t, x }) as Run[number]), STILL_PINCHES);
    expect(Math.max(...lv.map((l) => Math.abs(l - lv[0])))).toBeGreaterThan(4 * CM);
  });

  it("with no landmark noise the pinches leave depth within half a centimetre everywhere, transitions included", () => {
    const clean = pinchTraceFrames({ ...STILL_PINCHES, jitter: 0 });
    expect(spread(replay(clean, centred(clean)).map((r) => r.x))).toBeLessThan(0.5 * CM);
  });

  it("still follows real motion: pinched, then moving the hand toward the camera reaches forward", () => {
    const plan: PinchPlan = {
      ...STILL_PINCHES,
      pinches: 1,
      holdMs: 2000,
      // after the pinch closes (700 + 150 ms) and settles, come 20% closer over 600 ms, still pinched
      distance: (t) => 0.5 - 0.1 * Math.min(1, Math.max(0, (t - 1100) / 600)),
    };
    const moving = pinchTraceFrames(plan);
    const run = replay(moving, centred(moving));
    const at = (t: number) => run.find((r) => r.t >= t)!;
    expect(at(1050).gripper).toBe(1);
    expect(at(2400).x - at(1050).x).toBeGreaterThan(8 * CM);
  });

  it("re-anchors on a spacebar toggle too, so a key press never moves the arm", () => {
    const still = pinchTraceFrames({ ...STILL_PINCHES, pinches: 0, openMs: 2000 });
    const s = centred(still, { gripperInput: "space" });
    const run = replay(still, s, (t) => ({ clutch: false, spaceGripper: t > 600 && t < 1400 ? 1 : 0 }));
    expect(run.find((r) => r.t > 700)!.gripper).toBe(1);
    expect(run.find((r) => r.t > 1500)!.gripper).toBe(0);
    const before = median(run.filter((r) => r.t < 550).map((r) => r.x));
    const after = median(run.filter((r) => r.t > 1700).map((r) => r.x));
    expect(Math.abs(after - before)).toBeLessThan(0.5 * CM);
  });
});

describe("the spacebar gripper (A4)", () => {
  it("follows the key, not the pinch, when the gripper input is the spacebar", () => {
    const frames = pinchTraceFrames();
    const run = replay(frames, centred(frames, { gripperInput: "space" }));
    expect(run.every((r) => r.gripper === 0)).toBe(true); // pinching does nothing
    const pressed = replay(frames, centred(frames, { gripperInput: "space" }), () => ({ clutch: false, spaceGripper: 1 }));
    expect(pressed.every((r) => r.gripper === 1)).toBe(true);
  });

  it("is the pinch by default", () => {
    expect(DEFAULT_TELEOP_CONTROL.gripperInput).toBe("pinch");
  });
});

/** An open hand sliding sideways in the raw image: x from a to b over the trace. */
function sliding(a: number, b: number, ms = 1200): TraceFrame[] {
  return pinchTraceFrames({ ...STILL_PINCHES, pinches: 0, openMs: ms, jitter: 0, center: (t) => ({ x: a + ((b - a) * t) / ms, y: 0.45 }) });
}

describe("sensitivity (C8)", () => {
  it("scales the arm's motion for the same hand motion", () => {
    const frames = sliding(0.5, 0.45);
    const y1 = replay(frames, centred(frames)).map((r) => r.y);
    const y2 = replay(frames, centred(frames, { gain: 2 })).map((r) => r.y);
    const moved = (ys: number[]) => Math.abs(ys[ys.length - 1] - ys[0]);
    expect(moved(y2)).toBeCloseTo(2 * moved(y1), 2);
  });
});

describe("the clutch (C9)", () => {
  const frames = sliding(0.55, 0.42, 2400); // the hand drifts to the user's right the whole time
  const s = centred(frames);
  const clutchedBetween = (a: number, b: number) => (t: number): ControlInput => ({ clutch: t >= a && t < b, spaceGripper: 0 });

  it("freezes the target while held: moving the hand does nothing", () => {
    const run = replay(frames, s, clutchedBetween(800, 1600));
    const held = run.filter((r) => r.t >= 800 && r.t < 1600);
    expect(spread(held.map((r) => r.y))).toBeLessThan(1e-9);
    expect(run.filter((r) => r.t < 800).map((r) => r.y).some((y) => y !== run[0].y)).toBe(true);
  });

  it("lets go with no jump, then follows the hand relative to where it is now", () => {
    const run = replay(frames, s, clutchedBetween(800, 1600));
    const i = run.findIndex((r) => r.t >= 1600);
    const step = Math.abs(run[i].y - run[i - 1].y);
    const typical = Math.abs(run[5].y - run[4].y);
    expect(step).toBeLessThan(2 * typical + 1e-6); // no more than an ordinary frame's motion
    const free = replay(frames, s);
    // after the clutch the arm is behind the free-running one by what the hand moved while clutched
    expect(Math.abs(run[run.length - 1].y - free[free.length - 1].y)).toBeGreaterThan(5 * CM);
    expect(run[run.length - 1].y).toBeLessThan(run[i].y); // and still moving the same way (to the robot's right)
  });

  it("holds the gripper too while clutched", () => {
    const pinches = pinchTraceFrames();
    const run = replay(pinches, centred(pinches), () => ({ clutch: true, spaceGripper: 0 }));
    expect(run.every((r) => r.gripper === 0)).toBe(true);
  });
});

// A real debug trace (the Record page's "Debug trace" download) of a still hand pinching: run with
//   PM_TRACE=C:\path\pm-hand-trace-....json npx vitest run src/record/teleop/handControl.test.ts
// It prints the depth level of each stretch with the gripper open or closed, and fails if a level is more than 1 cm
// from the first. Skipped without PM_TRACE.
// The web app has no Node types (as src/twin/testFiles.ts): process is read off globalThis, node:fs loaded by name.
const PM_TRACE = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.PM_TRACE;
describe.runIf(!!PM_TRACE)("a real debug trace (PM_TRACE)", () => {
  it("keeps the depth level within 1 cm across its pinches", async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as { readFileSync(path: string, enc: string): string };
    const file = JSON.parse(fs.readFileSync(PM_TRACE!, "utf8")) as { settings: TeleopControlSettings; frames: TraceFrame[] };
    const frames = file.frames.filter((f) => f.landmarks);
    const run = replay(frames, { ...DEFAULT_TELEOP_CONTROL, ...file.settings, ...centred(frames, {}), view: "behind", gain: 1 });
    // stretches of one gripper state, minus 300 ms at each end
    const stretches: number[] = [];
    let from = 0;
    for (let i = 1; i <= run.length; i++) {
      if (i < run.length && run[i].gripper === run[from].gripper) continue;
      const mid = run.slice(from, i).filter((r) => r.t >= run[from].t + 300 && r.t <= run[i - 1].t - 300);
      if (mid.length) stretches.push(median(mid.map((r) => r.x)));
      from = i;
    }
    console.log(`[PM_TRACE] ${frames.length} frames, ${stretches.length} stretches, depth levels (m): ${stretches.map((x) => x.toFixed(3)).join(" ")}`);
    for (const l of stretches) expect(Math.abs(l - stretches[0])).toBeLessThan(1 * CM);
  });
});
