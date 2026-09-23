import { beforeEach, describe, expect, it } from "vitest";

import { LANDMARK, type ControlRegion, type HandFrame, type HandLandmark, type SelectEvent, type TwoHandZoomEvent } from "../contracts";
import { createGestureProcessor } from "./gestureProcessor";

// Large relative to the smoothing time constants (80ms/100ms) AND the select
// stability window (60ms) so a single subsequent frame converges/commits
// fully -- keeps assertions exact/near-exact instead of asserting
// partial-convergence or partial-debounce math, except in the dedicated
// stability-window tests below, which use small explicit timestamps instead.
const BIG_DT = 5000;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

function expectClose(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

function expectPointClose(actual: { x: number; y: number } | null, expected: { x: number; y: number }, tolerance = 1e-6): void {
  expect(actual).not.toBeNull();
  expectClose(actual!.x, expected.x, tolerance);
  expectClose(actual!.y, expected.y, tolerance);
}

function makeLandmarks(overrides: Partial<Record<number, { x: number; y: number; z?: number }>>): HandLandmark[] {
  const arr: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [idxStr, p] of Object.entries(overrides)) {
    if (!p) continue;
    arr[Number(idxStr)] = { x: p.x, y: p.y, z: p.z ?? 0 };
  }
  return arr;
}

// WRIST/INDEX_MCP/MIDDLE_MCP are placed as fixed OFFSETS from the given
// INDEX_TIP (rather than at an absolute location), so handSize (WRIST-to-
// INDEX_MCP = 0.5) and every ratio below is identical regardless of where on
// the [0,1] camera frame indexTip itself sits -- lets every gesture helper
// take an arbitrary cursor position as a parameter.
function baseGeometry(indexTip: { x: number; y: number }) {
  return {
    wrist: { x: indexTip.x, y: indexTip.y + 1 },
    indexMcp: { x: indexTip.x, y: indexTip.y + 0.5 }, // handSize = 0.5
    middleMcp: { x: indexTip.x + 0.02, y: indexTip.y + 0.5 },
  };
}

/** Not pinching (thumb far), select released (middle far from index) -- the baseline "hand present, doing nothing" pose. */
function openHandAt(indexTip: { x: number; y: number }): HandLandmark[] {
  const { wrist, indexMcp, middleMcp } = baseGeometry(indexTip);
  return makeLandmarks({
    [LANDMARK.WRIST]: wrist,
    [LANDMARK.INDEX_MCP]: indexMcp,
    [LANDMARK.MIDDLE_MCP]: middleMcp,
    [LANDMARK.THUMB_TIP]: { x: indexTip.x, y: indexTip.y + 1 },
    [LANDMARK.MIDDLE_TIP]: { x: indexTip.x - 2, y: indexTip.y },
    [LANDMARK.INDEX_TIP]: indexTip,
  });
}

/** Thumb/index pinching; index/middle stay released -- isolates pure pinch (feeds zoom only, no public event). */
function pinchedHandAt(indexTip: { x: number; y: number }): HandLandmark[] {
  const { wrist, indexMcp, middleMcp } = baseGeometry(indexTip);
  return makeLandmarks({
    [LANDMARK.WRIST]: wrist,
    [LANDMARK.INDEX_MCP]: indexMcp,
    [LANDMARK.MIDDLE_MCP]: middleMcp,
    [LANDMARK.THUMB_TIP]: indexTip,
    [LANDMARK.MIDDLE_TIP]: { x: indexTip.x - 2, y: indexTip.y },
    [LANDMARK.INDEX_TIP]: indexTip,
  });
}

/** Index/middle brought together, both still clearly extended (not a fist); thumb stays far -- a deliberate select pose. */
function selectClosedAt(indexTip: { x: number; y: number }): HandLandmark[] {
  const { wrist, indexMcp, middleMcp } = baseGeometry(indexTip);
  return makeLandmarks({
    [LANDMARK.WRIST]: wrist,
    [LANDMARK.INDEX_MCP]: indexMcp,
    [LANDMARK.MIDDLE_MCP]: middleMcp,
    [LANDMARK.THUMB_TIP]: { x: indexTip.x, y: indexTip.y + 1 },
    [LANDMARK.MIDDLE_TIP]: { x: indexTip.x + 0.01, y: indexTip.y },
    [LANDMARK.INDEX_TIP]: indexTip,
  });
}

/** Ambiguous pose: thumb/index pinching AND index/middle simultaneously read as closed+extended -- exactly what the priority rule exists for. */
function pinchingWithSelectPoseAt(indexTip: { x: number; y: number }): HandLandmark[] {
  const { wrist, indexMcp, middleMcp } = baseGeometry(indexTip);
  return makeLandmarks({
    [LANDMARK.WRIST]: wrist,
    [LANDMARK.INDEX_MCP]: indexMcp,
    [LANDMARK.MIDDLE_MCP]: middleMcp,
    [LANDMARK.THUMB_TIP]: indexTip,
    [LANDMARK.MIDDLE_TIP]: { x: indexTip.x + 0.01, y: indexTip.y },
    [LANDMARK.INDEX_TIP]: indexTip,
  });
}

/** A closed fist: index/middle fingertips curled back near their OWN MCP (and thus close together too) -- must never read as select. Position is irrelevant to this test, so no parameter. */
function fistHandAt(anchor: { x: number; y: number } = { x: 0.5, y: 0.5 }): HandLandmark[] {
  const wrist = { x: anchor.x, y: anchor.y + 1 };
  const indexMcp = { x: anchor.x, y: anchor.y + 0.5 }; // handSize = 0.5
  const middleMcp = { x: anchor.x + 0.02, y: anchor.y + 0.5 };
  return makeLandmarks({
    [LANDMARK.WRIST]: wrist,
    [LANDMARK.INDEX_MCP]: indexMcp,
    [LANDMARK.MIDDLE_MCP]: middleMcp,
    [LANDMARK.THUMB_TIP]: { x: anchor.x, y: anchor.y + 1 },
    [LANDMARK.INDEX_TIP]: { x: anchor.x, y: anchor.y + 0.52 }, // 0.02 from indexMcp -> extension ratio 0.04, well under 0.5
    [LANDMARK.MIDDLE_TIP]: { x: anchor.x + 0.02, y: anchor.y + 0.52 }, // 0.02 from middleMcp -> extension ratio 0.04
  });
}

function frame(timestamp: number, hands: HandFrame["hands"], frameWidth = 100, frameHeight = 100): HandFrame {
  return { timestamp, hands, frameWidth, frameHeight };
}

const CUSTOM_REGION: ControlRegion = { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 }; // raw rect [0.3,0.7]^2

beforeEach(() => {
  setViewport(1000, 1000);
});

describe("control-region mapping", () => {
  it("maps the region center to the viewport center", () => {
    const gp = createGestureProcessor();
    gp.setControlRegion(CUSTOM_REGION);
    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.5 }) }]));
    expect(gp.cursor).toEqual({ x: 500, y: 500 });
  });

  it("mirrors x: the region's raw left edge maps to the viewport's right edge and vice versa", () => {
    const left = createGestureProcessor();
    left.setControlRegion(CUSTOM_REGION);
    left.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.3, y: 0.5 }) }]));
    expect(left.cursor).toEqual({ x: 1000, y: 500 });

    const right = createGestureProcessor();
    right.setControlRegion(CUSTOM_REGION);
    right.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.7, y: 0.5 }) }]));
    expectPointClose(right.cursor, { x: 0, y: 500 });
  });

  it("never flips y", () => {
    const top = createGestureProcessor();
    top.setControlRegion(CUSTOM_REGION);
    top.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.3 }) }]));
    expect(top.cursor).toEqual({ x: 500, y: 0 });

    const bottom = createGestureProcessor();
    bottom.setControlRegion(CUSTOM_REGION);
    bottom.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.7 }) }]));
    expectPointClose(bottom.cursor, { x: 500, y: 1000 });
  });

  it("clamps points outside the region to the viewport edge instead of extrapolating", () => {
    const beyondRight = createGestureProcessor();
    beyondRight.setControlRegion(CUSTOM_REGION);
    beyondRight.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.9, y: 0.5 }) }]));
    expect(beyondRight.cursor).toEqual({ x: 0, y: 500 }); // same as raw x=0.7 (region edge)

    const beyondLeft = createGestureProcessor();
    beyondLeft.setControlRegion(CUSTOM_REGION);
    beyondLeft.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.05, y: 0.5 }) }]));
    expect(beyondLeft.cursor).toEqual({ x: 1000, y: 500 }); // same as raw x=0.3 (region edge)
  });

  it("reads window size live -- a fresh update reflects the current viewport, not one cached at construction", () => {
    const gp = createGestureProcessor();
    gp.setControlRegion(CUSTOM_REGION);
    setViewport(800, 800);
    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.5 }) }]));
    expect(gp.cursor).toEqual({ x: 400, y: 400 });

    gp.reset(); // clears the smoother so the next sample snaps instead of easing toward the new target
    setViewport(1600, 1600);
    gp.update(frame(1, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.5 }) }]));
    expect(gp.cursor).toEqual({ x: 800, y: 800 });
  });

  it("queues a region change made mid-select and only applies it once the primary hand releases", () => {
    const REGION_A: ControlRegion = { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 }; // [0.3,0.7]
    const REGION_B: ControlRegion = { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 }; // [0.4,0.6]
    const point = { x: 0.6, y: 0.5 };
    const gp = createGestureProcessor();
    gp.setControlRegion(REGION_A);

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // close streak begins
    gp.update(frame(2 * BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // held past the stability window -> selectstart
    expect(gp.isSelecting).toBe(true);
    expectClose(gp.cursor!.x, 250); // REGION_A: t=0.75 -> mirrored 0.25 -> 250px

    gp.setControlRegion(REGION_B); // must be queued -- a gesture is in progress

    gp.update(frame(3 * BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // still selecting
    expectClose(gp.cursor!.x, 250, 5); // still REGION_A -- not applied mid-gesture

    gp.update(frame(4 * BIG_DT, [{ handedness: "Right", landmarks: openHandAt(point) }])); // release streak begins
    gp.update(frame(5 * BIG_DT, [{ handedness: "Right", landmarks: openHandAt(point) }])); // held past the release window -> selectend
    expect(gp.isSelecting).toBe(false);
    expectClose(gp.cursor!.x, 250, 5); // still REGION_A this frame (flush is checked at the TOP of the next update)

    gp.update(frame(6 * BIG_DT, [{ handedness: "Right", landmarks: openHandAt(point) }])); // first frame after release
    expectClose(gp.cursor!.x, 0, 5); // REGION_B: raw 0.6 is clamped to the region's right edge -> mirrored 0
  });
});

describe("primary/secondary hand identity", () => {
  it("keeps the same physical hand primary across a detector array-order swap", () => {
    const gp = createGestureProcessor();
    gp.setControlRegion(CUSTOM_REGION);
    const rightPoint = { x: 0.6, y: 0.5 }; // -> cursor.x = (1 - 0.75)*1000 = 250
    const leftPoint = { x: 0.4, y: 0.5 }; // -> cursor.x = (1 - 0.25)*1000 = 750

    gp.update(
      frame(0, [
        { handedness: "Right", landmarks: openHandAt(rightPoint) },
        { handedness: "Left", landmarks: openHandAt(leftPoint) },
      ]),
    );
    expectPointClose(gp.cursor, { x: 250, y: 500 });
    expectPointClose(gp.secondaryCursor, { x: 750, y: 500 });

    // Same physical hands, same positions, array order swapped.
    gp.update(
      frame(BIG_DT, [
        { handedness: "Left", landmarks: openHandAt(leftPoint) },
        { handedness: "Right", landmarks: openHandAt(rightPoint) },
      ]),
    );
    expectPointClose(gp.cursor, { x: 250, y: 500 }); // still Right's position -> primary identity unchanged
    expectPointClose(gp.secondaryCursor, { x: 750, y: 500 });
  });

  it("promotes the other hand to primary immediately once the original primary's identity is absent", () => {
    const gp = createGestureProcessor();
    gp.setControlRegion(CUSTOM_REGION);
    const rightPoint = { x: 0.6, y: 0.5 };
    const leftPoint = { x: 0.4, y: 0.5 };

    gp.update(
      frame(0, [
        { handedness: "Right", landmarks: openHandAt(rightPoint) },
        { handedness: "Left", landmarks: openHandAt(leftPoint) },
      ]),
    );
    expectPointClose(gp.cursor, { x: 250, y: 500 }); // Right primary

    gp.update(frame(BIG_DT, [{ handedness: "Left", landmarks: openHandAt(leftPoint) }])); // Right vanished
    expectPointClose(gp.cursor, { x: 750, y: 500 }); // Left promoted to primary
    expect(gp.secondaryCursor).toBeNull();
  });

  it("never lets a second hand move cursor or affect the primary select stream", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }]));
    gp.update(frame(2 * BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // selectstart
    const cursorWhileSelecting = gp.cursor;
    expect(events.map((e) => e.type)).toEqual(["selectstart"]);

    // A second hand joins and closes its own fingers too -- must not move `cursor` or emit on the primary stream.
    gp.update(
      frame(3 * BIG_DT, [
        { handedness: "Right", landmarks: selectClosedAt(point) },
        { handedness: "Left", landmarks: selectClosedAt({ x: 0.2, y: 0.5 }) },
      ]),
    );
    expect(gp.cursor).toEqual(cursorWhileSelecting);
    expect(events.map((e) => e.type)).toEqual(["selectstart", "selectmove"]); // primary's own continued select, nothing from Left
  });
});

describe("primary select lifecycle", () => {
  it("requires the close pose to hold for the full stability window before committing selectstart", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // streak begins at t=10
    expect(gp.isSelecting).toBe(false);

    gp.update(frame(40, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // 30ms held -- under the 60ms window
    expect(gp.isSelecting).toBe(false);

    gp.update(frame(80, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // 70ms held -- window elapsed
    expect(gp.isSelecting).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["selectstart"]);
  });

  it("resets the stability streak if the close pose is interrupted, even briefly", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // streak begins
    gp.update(frame(40, [{ handedness: "Right", landmarks: openHandAt(point) }])); // interrupted before the window elapses
    gp.update(frame(80, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // a NEW streak starts here
    expect(gp.isSelecting).toBe(false); // 0ms into the new streak

    gp.update(frame(150, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // 70ms into the new streak
    expect(gp.isSelecting).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["selectstart"]);
  });

  it("applies the same stability debounce to the release transition", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: selectClosedAt(point) }]));
    gp.update(frame(80, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // selectstart
    expect(gp.isSelecting).toBe(true);

    gp.update(frame(90, [{ handedness: "Right", landmarks: openHandAt(point) }])); // release streak begins
    expect(gp.isSelecting).toBe(true);

    gp.update(frame(120, [{ handedness: "Right", landmarks: openHandAt(point) }])); // 30ms held open -- under the window
    expect(gp.isSelecting).toBe(true);

    gp.update(frame(160, [{ handedness: "Right", landmarks: openHandAt(point) }])); // 70ms held open -- window elapsed
    expect(gp.isSelecting).toBe(false);

    expect(events.map((e) => e.type)).toEqual(["selectstart", "selectmove", "selectmove", "selectend"]);
  });

  it("does not immediately select a hand that reappears already closed -- the window still has to elapse from reacquisition", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [])); // hand leaves
    gp.update(frame(20, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // reappears ALREADY closed
    expect(gp.isSelecting).toBe(false);

    gp.update(frame(50, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // 30ms since reappearance
    expect(gp.isSelecting).toBe(false);

    gp.update(frame(90, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // 70ms since reappearance -- window elapsed
    expect(gp.isSelecting).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["selectstart"]); // nothing was ever selecting, so no cancel either
  });

  it("never selects from a closed fist (fingertips curled back toward their own MCP), even held indefinitely", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt({ x: 0.5, y: 0.5 }) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: fistHandAt() }]));
    gp.update(frame(200, [{ handedness: "Right", landmarks: fistHandAt() }])); // well past the stability window
    gp.update(frame(1000, [{ handedness: "Right", landmarks: fistHandAt() }]));

    expect(gp.isSelecting).toBe(false);
    expect(events).toEqual([]);
  });

  it("cancels (not selectend) when the primary hand is lost mid-select", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: selectClosedAt(point) }]));
    gp.update(frame(80, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // selectstart
    expect(gp.isSelecting).toBe(true);

    gp.update(frame(90, [])); // hand lost mid-select
    expect(gp.isSelecting).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["selectstart", "cancel"]);
  });
});

describe("select/pinch priority", () => {
  it("never lets select's stability countdown begin while the primary hand is pinching, even with an ambiguous closed+extended pose", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: pinchingWithSelectPoseAt(point) }]));
    gp.update(frame(200, [{ handedness: "Right", landmarks: pinchingWithSelectPoseAt(point) }])); // held well past the stability window
    gp.update(frame(1000, [{ handedness: "Right", landmarks: pinchingWithSelectPoseAt(point) }]));

    expect(gp.isSelecting).toBe(false);
    expect(events).toEqual([]);
  });

  it("cancels an already-active select the instant the primary hand's pinch engages", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(10, [{ handedness: "Right", landmarks: selectClosedAt(point) }]));
    gp.update(frame(80, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // selectstart
    expect(gp.isSelecting).toBe(true);

    gp.update(frame(90, [{ handedness: "Right", landmarks: pinchingWithSelectPoseAt(point) }])); // pinch engages mid-select
    expect(gp.isSelecting).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["selectstart", "cancel"]);
  });

  it("leaves two-hand zoom kinematics unaffected by an attempted/preempted select on the primary hand", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    gp.update(
      frame(0, [
        { handedness: "Right", landmarks: openHandAt({ x: 0.4, y: 0.5 }) },
        { handedness: "Left", landmarks: openHandAt({ x: 0.6, y: 0.5 }) },
      ]),
    );
    gp.update(
      frame(BIG_DT, [
        { handedness: "Right", landmarks: pinchingWithSelectPoseAt({ x: 0.4, y: 0.5 }) },
        { handedness: "Left", landmarks: pinchedHandAt({ x: 0.6, y: 0.5 }) },
      ]),
    );

    expect(zoomEvents.map((e) => e.type)).toEqual(["zoomstart"]);
    expect(gp.zoomRatio).toBe(1);
  });
});

describe("two-hand pinch-to-zoom", () => {
  function armAndStart(gp: ReturnType<typeof createGestureProcessor>, rightPoint: { x: number; y: number }, leftPoint: { x: number; y: number }) {
    gp.update(
      frame(0, [
        { handedness: "Right", landmarks: openHandAt(rightPoint) },
        { handedness: "Left", landmarks: openHandAt(leftPoint) },
      ]),
    );
    gp.update(
      frame(BIG_DT, [
        { handedness: "Right", landmarks: pinchedHandAt(rightPoint) },
        { handedness: "Left", landmarks: pinchedHandAt(leftPoint) },
      ]),
    );
  }

  it("starts at ratio 1 the frame both identified hands become pinching", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    armAndStart(gp, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 });

    expect(gp.zoomRatio).toBe(1);
    expect(zoomEvents.map((e) => e.type)).toEqual(["zoomstart"]);
    expect(zoomEvents[0].ratio).toBe(1);
  });

  it("does not start zoom from a degenerate (near-zero) baseline separation", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    armAndStart(gp, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }); // hands on top of each other
    expect(gp.zoomRatio).toBeNull();
    expect(zoomEvents).toEqual([]);
  });

  it("scales the ratio with separation change (rate-limited and smoothed)", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    armAndStart(gp, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }); // baseline separation 0.2

    // Separation doubles to 0.4 -> raw ratio 2.0, but a single frame can only move by ZOOM_MAX_RATIO_DELTA_PER_FRAME (0.15).
    gp.update(
      frame(2 * BIG_DT, [
        { handedness: "Right", landmarks: pinchedHandAt({ x: 0.3, y: 0.5 }) },
        { handedness: "Left", landmarks: pinchedHandAt({ x: 0.7, y: 0.5 }) },
      ]),
    );
    expectClose(gp.zoomRatio!, 1.15, 0.02);
    expect(zoomEvents[zoomEvents.length - 1].type).toBe("zoomchange");
  });

  it("applies a dead zone around ratio 1 so small jitter doesn't register as a zoom", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    armAndStart(gp, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }); // baseline separation 0.2

    // Separation 0.202 -> raw ratio 1.01, inside the +-2% dead zone.
    gp.update(
      frame(2 * BIG_DT, [
        { handedness: "Right", landmarks: pinchedHandAt({ x: 0.399, y: 0.5 }) },
        { handedness: "Left", landmarks: pinchedHandAt({ x: 0.601, y: 0.5 }) },
      ]),
    );
    expect(gp.zoomRatio).toBe(1);
    expect(zoomEvents[zoomEvents.length - 1].ratio).toBe(1);
  });

  it("ends normally (zoomend) when the pinch releases with both hands still tracked", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    armAndStart(gp, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 });
    gp.update(
      frame(2 * BIG_DT, [
        { handedness: "Right", landmarks: openHandAt({ x: 0.4, y: 0.5 }) },
        { handedness: "Left", landmarks: openHandAt({ x: 0.6, y: 0.5 }) },
      ]),
    );

    expect(gp.zoomRatio).toBeNull();
    expect(zoomEvents.map((e) => e.type)).toEqual(["zoomstart", "zoomend"]);
  });

  it("cancels (zoomcancel, not zoomend) when either hand becomes untracked mid-zoom, without spuriously firing a select event on the still-tracked primary hand", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    const selectEvents: SelectEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));
    gp.onSelectEvent((e) => selectEvents.push(e));

    armAndStart(gp, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }); // Right primary, Left secondary

    gp.update(frame(2 * BIG_DT, [{ handedness: "Right", landmarks: pinchedHandAt({ x: 0.4, y: 0.5 }) }])); // Left (secondary) lost

    expect(zoomEvents.map((e) => e.type)).toEqual(["zoomstart", "zoomcancel"]);
    expect(gp.zoomRatio).toBeNull();
    // Select was correctly suppressed by the priority rule throughout (Right was pinching) -- nothing to spuriously cancel.
    expect(selectEvents).toEqual([]);
  });
});

describe("reset()", () => {
  it("clears role assignment, per-hand gesture state, and any in-progress zoom without emitting a zoom event", () => {
    const gp = createGestureProcessor();
    const zoomEvents: TwoHandZoomEvent[] = [];
    gp.onZoomEvent((e) => zoomEvents.push(e));

    gp.update(
      frame(0, [
        { handedness: "Right", landmarks: openHandAt({ x: 0.4, y: 0.5 }) },
        { handedness: "Left", landmarks: openHandAt({ x: 0.6, y: 0.5 }) },
      ]),
    );
    gp.update(
      frame(BIG_DT, [
        { handedness: "Right", landmarks: pinchedHandAt({ x: 0.4, y: 0.5 }) },
        { handedness: "Left", landmarks: pinchedHandAt({ x: 0.6, y: 0.5 }) },
      ]),
    );
    expect(gp.zoomRatio).toBe(1);

    zoomEvents.length = 0;
    gp.reset();

    expect(zoomEvents).toEqual([]); // implicit cancel, no event
    expect(gp.zoomRatio).toBeNull();
    expect(gp.cursor).toBeNull();
    expect(gp.secondaryCursor).toBeNull();
    expect(gp.isSelecting).toBe(false);

    // A fresh hand re-establishes primary from scratch (role state was cleared, not left pointing at "Right").
    gp.update(frame(2 * BIG_DT, [{ handedness: "Left", landmarks: openHandAt({ x: 0.5, y: 0.5 }) }]));
    expect(gp.cursor).not.toBeNull();
  });

  it("clears an in-progress select with no event on reset", () => {
    const gp = createGestureProcessor();
    const events: SelectEvent[] = [];
    gp.onSelectEvent((e) => events.push(e));
    const point = { x: 0.5, y: 0.5 };

    gp.update(frame(0, [{ handedness: "Right", landmarks: openHandAt(point) }]));
    gp.update(frame(BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }]));
    gp.update(frame(2 * BIG_DT, [{ handedness: "Right", landmarks: selectClosedAt(point) }])); // selectstart
    expect(gp.isSelecting).toBe(true);

    events.length = 0;
    gp.reset();

    expect(events).toEqual([]);
    expect(gp.isSelecting).toBe(false);
  });
});
