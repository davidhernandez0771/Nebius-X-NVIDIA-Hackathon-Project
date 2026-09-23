// GestureProcessor (Agent 2): raw HandFrame -> control-region-mapped cursor(s)
// + primary SELECT events + two-hand zoom kinematics.
//
// See the JSDoc on GestureProcessor in ../contracts.ts for the binding spec
// this implements (region mapping order, primary/secondary selection, the
// select/pinch priority rule, zoom state machine). This file is
// DOM/context-free by design -- no document/window reads other than
// innerWidth/innerHeight for the final viewport scale, and no knowledge of
// what's on screen.

import {
  DEFAULT_CONTROL_REGION,
  LANDMARK,
  type ControlRegion,
  type GestureProcessor,
  type HandFrame,
  type HandLandmark,
  type Handedness,
  type SelectEvent,
  type SelectEventType,
  type TwoHandZoomEvent,
  type TwoHandZoomEventType,
  type ViewportPoint,
} from "../contracts";

// EMA time constant for cursor smoothing. Short enough that pointing still
// feels immediate (~2-3 frames of lag at a typical 30fps webcam feed), long
// enough to absorb per-frame landmark jitter.
const SMOOTHING_TAU_MS = 80;

// Thumb/index PINCH -- Revision 4: purely internal now (feeds the
// select/pinch priority rule and two-hand zoom only, no public event/getter).
// Ratios/behavior unchanged from Revisions 2-3.
const PINCH_ENTER_RATIO = 0.4;
const PINCH_EXIT_RATIO = 0.65;

// Index/middle SELECT (Revision 4) -- the one-hand click/drag gesture.
// Index and middle are adjacent digits, naturally closer together at rest
// than thumb/index, so these ratios are deliberately smaller than pinch's.
// Reasoned from landmark geometry, not measured against a live hand --
// see HANDOFF_AGENT2.md.
const SELECT_CLOSE_RATIO = 0.22;
const SELECT_RELEASE_RATIO = 0.38;
// Stability window: the close (or release) transition must hold
// continuously for this long before committing -- applied symmetrically to
// both transitions, per contracts.ts. Also what makes a hand that appears
// already-closed unable to select immediately (the full window still has to
// elapse from the frame it's first observed).
const SELECT_STABILITY_MS = 60;
// Fist rejection: INDEX_TIP and MIDDLE_TIP must each still be at least this
// many hand-size-units from their own MCP to count as "extended" -- a curled
// fist brings a fingertip back near its MCP, well under this.
const MIN_FINGER_EXTENSION_RATIO = 0.5;

// Two-hand zoom tuning -- unchanged from Revision 3.
const ZOOM_DEAD_ZONE = 0.02; // +-2% around ratio 1 reads as "no change"
const ZOOM_MAX_RATIO_DELTA_PER_FRAME = 0.15; // guards a single bad detection frame snapping the ratio
const ZOOM_SMOOTHING_TAU_MS = 100;
const ZOOM_BASELINE_EPSILON = 0.01; // degenerate (hands on top of each other) -- don't start zoom

function distance2D(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface PinchIdentityState {
  pinching: boolean;
  // "release-before-rearm": a given hand's pinch cannot re-engage until that
  // SAME hand has been observed open, independent of the other hand. Still
  // relevant in Revision 4 even though pinch has no public event -- it feeds
  // the select/pinch priority rule and zoom, both of which care about
  // spurious immediate-re-pinch on reacquisition just as much as the old
  // public stream did.
  requireOpenBeforeArm: boolean;
}

function freshPinchState(): PinchIdentityState {
  return { pinching: false, requireOpenBeforeArm: true };
}

// Exponential-moving-average smoothing for one region-mapped cursor point.
// A fresh instance (or one that has been reset()) snaps to the next sample
// instead of smoothing from a stale/absent position -- used both for "no
// hand yet" and for "this role's underlying hand identity just changed"
// (a physically different hand jumping in is not something to interpolate
// across). Never reset by select/pinch state changes (see contracts.ts).
class CursorSmoother {
  private x: number | null = null;
  private y: number | null = null;

  reset(): void {
    this.x = null;
    this.y = null;
  }

  sample(rawX: number, rawY: number, dt: number): ViewportPoint {
    if (this.x === null || this.y === null) {
      this.x = rawX;
      this.y = rawY;
    } else {
      const alpha = 1 - Math.exp(-dt / SMOOTHING_TAU_MS);
      this.x += alpha * (rawX - this.x);
      this.y += alpha * (rawY - this.y);
    }
    return { x: this.x, y: this.y };
  }
}

class GestureProcessorImpl implements GestureProcessor {
  private lastTimestamp: number | null = null;

  private region: ControlRegion = DEFAULT_CONTROL_REGION;
  private pendingRegion: ControlRegion | null = null;

  private primaryHandedness: Handedness | null = null;
  private secondaryHandedness: Handedness | null = null;

  private readonly pinchStates: Map<Handedness, PinchIdentityState> = new Map([
    ["Left", freshPinchState()],
    ["Right", freshPinchState()],
  ]);

  // SELECT is primary-only, so a flat (non-keyed) state is sufficient --
  // it's reset/cancelled whenever the primary identity itself changes (see
  // handleAbsentIdentities and the identity-change check in update()).
  private selecting = false;
  private selectCloseStreakStart: number | null = null; // ms timestamp the close+pose streak began, or null
  private selectOpenStreakStart: number | null = null; // ms timestamp the release streak began, or null

  private readonly primarySmoother = new CursorSmoother();
  private readonly secondarySmoother = new CursorSmoother();
  private primaryCursorPoint: ViewportPoint | null = null;
  private secondaryCursorPoint: ViewportPoint | null = null;

  private zoomActive = false;
  private zoomBaselineSeparation = 0;
  private zoomPrevRawRatio = 1;
  private zoomLastRatio = 1;

  private readonly selectListeners = new Set<(event: SelectEvent) => void>();
  private readonly zoomListeners = new Set<(event: TwoHandZoomEvent) => void>();

  get cursor(): ViewportPoint | null {
    return this.primaryCursorPoint;
  }

  get secondaryCursor(): ViewportPoint | null {
    return this.secondaryCursorPoint;
  }

  get isSelecting(): boolean {
    return this.selecting;
  }

  get zoomRatio(): number | null {
    return this.zoomActive ? this.zoomLastRatio : null;
  }

  onSelectEvent(cb: (event: SelectEvent) => void): () => void {
    this.selectListeners.add(cb);
    return () => {
      this.selectListeners.delete(cb);
    };
  }

  onZoomEvent(cb: (event: TwoHandZoomEvent) => void): () => void {
    this.zoomListeners.add(cb);
    return () => {
      this.zoomListeners.delete(cb);
    };
  }

  setControlRegion(region: ControlRegion): void {
    if (this.gestureInProgress()) {
      this.pendingRegion = region;
    } else {
      this.region = region;
      this.pendingRegion = null;
    }
  }

  reset(): void {
    this.lastTimestamp = null;
    this.pendingRegion = null;
    this.primaryHandedness = null;
    this.secondaryHandedness = null;
    this.pinchStates.set("Left", freshPinchState());
    this.pinchStates.set("Right", freshPinchState());
    this.selecting = false;
    this.selectCloseStreakStart = null;
    this.selectOpenStreakStart = null;
    this.primarySmoother.reset();
    this.secondarySmoother.reset();
    this.primaryCursorPoint = null;
    this.secondaryCursorPoint = null;
    this.endZoomState();
    // NOTE: this.region (the currently-applied calibration) is intentionally
    // left untouched -- reset() clears the pending-region QUEUE and gesture/
    // role state, not the persisted calibration.
  }

  update(frame: HandFrame): void {
    const dt = this.lastTimestamp !== null ? frame.timestamp - this.lastTimestamp : 0;
    this.lastTimestamp = frame.timestamp;

    if (this.pendingRegion && !this.gestureInProgress()) {
      this.region = this.pendingRegion;
      this.pendingRegion = null;
    }

    const identified = new Map<Handedness, HandLandmark[]>();
    const order: Handedness[] = [];
    for (const hand of frame.hands) {
      if (hand.handedness === null) continue;
      if (!identified.has(hand.handedness)) order.push(hand.handedness);
      identified.set(hand.handedness, hand.landmarks);
    }

    const oldPrimary = this.primaryHandedness;
    const oldSecondary = this.secondaryHandedness;

    this.handleAbsentIdentities(identified, oldPrimary, frame.timestamp);

    if (
      this.zoomActive &&
      ((oldPrimary !== null && !identified.has(oldPrimary)) ||
        (oldSecondary !== null && !identified.has(oldSecondary)))
    ) {
      this.emitZoom("zoomcancel", this.zoomLastRatio, frame.timestamp);
      this.endZoomState();
    }

    this.assignRoles(identified, order);

    if (this.primaryHandedness !== oldPrimary) {
      this.primarySmoother.reset();
      // Defensive cleanup only -- handleAbsentIdentities above already
      // resolved (and, if needed, emitted "cancel" for) the old primary's
      // select state using oldPrimary before roles were reassigned.
      this.selectCloseStreakStart = null;
      this.selectOpenStreakStart = null;
    }
    if (this.secondaryHandedness !== oldSecondary) this.secondarySmoother.reset();

    this.updatePrimary(identified, dt, frame.timestamp);
    this.updateSecondary(identified, dt);

    this.updateZoom(identified, frame, dt);
  }

  // -- internals -----------------------------------------------------------

  private gestureInProgress(): boolean {
    const primaryPinching =
      this.primaryHandedness !== null && !!this.pinchStates.get(this.primaryHandedness)?.pinching;
    return this.selecting || primaryPinching || this.zoomActive;
  }

  private handleAbsentIdentities(
    identified: Map<Handedness, HandLandmark[]>,
    oldPrimary: Handedness | null,
    timestamp: number,
  ): void {
    (["Left", "Right"] as Handedness[]).forEach((h) => {
      if (identified.has(h)) return;
      this.pinchStates.set(h, freshPinchState());

      if (h !== oldPrimary) return;
      // Primary hand lost -- any in-progress select streak is invalidated,
      // and a fully-committed select is cancelled (not selectend).
      this.selectCloseStreakStart = null;
      this.selectOpenStreakStart = null;
      if (this.selecting) {
        const point = this.primaryCursorPoint ?? { x: 0, y: 0 };
        this.selecting = false;
        this.emitSelect("cancel", point, timestamp);
      }
    });
  }

  private assignRoles(identified: Map<Handedness, HandLandmark[]>, order: Handedness[]): void {
    if (this.primaryHandedness === null) {
      if (order.length > 0) this.primaryHandedness = order[0];
    } else if (!identified.has(this.primaryHandedness)) {
      const other = order.find((h) => h !== this.primaryHandedness);
      if (other) this.primaryHandedness = other;
    }

    if (this.primaryHandedness !== null && identified.has(this.primaryHandedness)) {
      const other = order.find((h) => h !== this.primaryHandedness);
      this.secondaryHandedness = other ?? null;
    } else {
      this.secondaryHandedness = null;
    }
  }

  private mapRegion(rawPoint: HandLandmark): { x: number; y: number } {
    const r = this.region;
    const w = r.width || Number.EPSILON;
    const h = r.height || Number.EPSILON;
    const tX = (rawPoint.x - (r.centerX - w / 2)) / w;
    const tY = (rawPoint.y - (r.centerY - h / 2)) / h;
    const clampedX = Math.min(1, Math.max(0, tX));
    const clampedY = Math.min(1, Math.max(0, tY));
    const mirroredX = 1 - clampedX; // mirror applied exactly once, here
    return { x: mirroredX * window.innerWidth, y: clampedY * window.innerHeight };
  }

  private handSize(landmarks: HandLandmark[]): number {
    return distance2D(landmarks[LANDMARK.WRIST], landmarks[LANDMARK.INDEX_MCP]) || Number.EPSILON;
  }

  private pinchRatio(landmarks: HandLandmark[]): number {
    const thumbTip = landmarks[LANDMARK.THUMB_TIP];
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    return distance2D(thumbTip, indexTip) / this.handSize(landmarks);
  }

  private selectRatio(landmarks: HandLandmark[]): number {
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    const middleTip = landmarks[LANDMARK.MIDDLE_TIP];
    return distance2D(indexTip, middleTip) / this.handSize(landmarks);
  }

  /** Fist rejection: both fingertips must still read as extended away from their own MCP. */
  private fingersExtended(landmarks: HandLandmark[]): boolean {
    const size = this.handSize(landmarks);
    const indexExtension = distance2D(landmarks[LANDMARK.INDEX_TIP], landmarks[LANDMARK.INDEX_MCP]) / size;
    const middleExtension = distance2D(landmarks[LANDMARK.MIDDLE_TIP], landmarks[LANDMARK.MIDDLE_MCP]) / size;
    return indexExtension >= MIN_FINGER_EXTENSION_RATIO && middleExtension >= MIN_FINGER_EXTENSION_RATIO;
  }

  /** Mutates `state` in place; returns the transition (if any) for the caller to react to. */
  private updatePinchHysteresis(state: PinchIdentityState, ratio: number): "start" | "end" | null {
    if (state.requireOpenBeforeArm && ratio >= PINCH_EXIT_RATIO) {
      state.requireOpenBeforeArm = false;
    }
    if (!state.pinching) {
      if (!state.requireOpenBeforeArm && ratio <= PINCH_ENTER_RATIO) {
        state.pinching = true;
        return "start";
      }
      return null;
    }
    if (ratio >= PINCH_EXIT_RATIO) {
      state.pinching = false;
      return "end";
    }
    return null;
  }

  private updatePrimary(identified: Map<Handedness, HandLandmark[]>, dt: number, timestamp: number): void {
    if (this.primaryHandedness === null || !identified.has(this.primaryHandedness)) {
      this.primarySmoother.reset();
      this.primaryCursorPoint = null;
      this.selectCloseStreakStart = null;
      this.selectOpenStreakStart = null;
      return;
    }

    const landmarks = identified.get(this.primaryHandedness)!;
    const raw = this.mapRegion(landmarks[LANDMARK.INDEX_TIP]);
    const point = this.primarySmoother.sample(raw.x, raw.y, dt);
    this.primaryCursorPoint = point;

    // Primary's own PINCH (thumb/index) -- internal only, feeds the priority
    // rule below and two-hand zoom. No public event.
    const pinchState = this.pinchStates.get(this.primaryHandedness)!;
    this.updatePinchHysteresis(pinchState, this.pinchRatio(landmarks));

    // Priority rule: pinch preempts select on the primary hand. If select
    // was already active the moment pinch engages, cancel it immediately.
    if (pinchState.pinching && this.selecting) {
      this.selecting = false;
      this.selectOpenStreakStart = null;
      this.emitSelect("cancel", point, timestamp);
    }
    // While pinching, select's stability countdown must not even begin.
    if (pinchState.pinching) {
      this.selectCloseStreakStart = null;
      return;
    }

    this.updateSelectGesture(landmarks, point, timestamp);
  }

  private updateSelectGesture(landmarks: HandLandmark[], point: ViewportPoint, timestamp: number): void {
    const ratio = this.selectRatio(landmarks);

    if (!this.selecting) {
      if (ratio <= SELECT_CLOSE_RATIO && this.fingersExtended(landmarks)) {
        if (this.selectCloseStreakStart === null) this.selectCloseStreakStart = timestamp;
        if (timestamp - this.selectCloseStreakStart >= SELECT_STABILITY_MS) {
          this.selecting = true;
          this.selectCloseStreakStart = null;
          this.selectOpenStreakStart = null;
          this.emitSelect("selectstart", point, timestamp);
        }
      } else {
        this.selectCloseStreakStart = null; // streak broken: ratio back open, or a fist (pose check failed)
      }
      return;
    }

    if (ratio >= SELECT_RELEASE_RATIO) {
      if (this.selectOpenStreakStart === null) this.selectOpenStreakStart = timestamp;
      if (timestamp - this.selectOpenStreakStart >= SELECT_STABILITY_MS) {
        this.selecting = false;
        this.selectOpenStreakStart = null;
        this.emitSelect("selectend", point, timestamp);
        return;
      }
    } else {
      this.selectOpenStreakStart = null; // streak broken: still closed
    }
    this.emitSelect("selectmove", point, timestamp);
  }

  private updateSecondary(identified: Map<Handedness, HandLandmark[]>, dt: number): void {
    if (this.secondaryHandedness === null || !identified.has(this.secondaryHandedness)) {
      this.secondarySmoother.reset();
      this.secondaryCursorPoint = null;
      return;
    }

    const landmarks = identified.get(this.secondaryHandedness)!;
    const raw = this.mapRegion(landmarks[LANDMARK.INDEX_TIP]);
    this.secondaryCursorPoint = this.secondarySmoother.sample(raw.x, raw.y, dt);

    // Own pinch hysteresis, tracked for zoom kinematics only -- select is
    // primary-only, no public event for the secondary hand.
    const state = this.pinchStates.get(this.secondaryHandedness)!;
    this.updatePinchHysteresis(state, this.pinchRatio(landmarks));
  }

  private pinchMidpoint(landmarks: HandLandmark[]): { x: number; y: number } {
    const thumbTip = landmarks[LANDMARK.THUMB_TIP];
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    return { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
  }

  /** Aspect-corrected 2D distance between each hand's pinch point (THUMB_TIP/INDEX_TIP midpoint). */
  private handSeparation(a: HandLandmark[], b: HandLandmark[], frameWidth: number, frameHeight: number): number {
    const pa = this.pinchMidpoint(a);
    const pb = this.pinchMidpoint(b);
    const aspect = frameHeight > 0 ? frameWidth / frameHeight : 1;
    const dx = (pa.x - pb.x) * aspect;
    const dy = pa.y - pb.y;
    return Math.hypot(dx, dy);
  }

  private updateZoom(identified: Map<Handedness, HandLandmark[]>, frame: HandFrame, dt: number): void {
    const primary = this.primaryHandedness;
    const secondary = this.secondaryHandedness;
    const bothPinching =
      primary !== null &&
      secondary !== null &&
      identified.has(primary) &&
      identified.has(secondary) &&
      !!this.pinchStates.get(primary)?.pinching &&
      !!this.pinchStates.get(secondary)?.pinching;

    if (bothPinching && !this.zoomActive) {
      const a = identified.get(primary!)!;
      const b = identified.get(secondary!)!;
      const baseline = this.handSeparation(a, b, frame.frameWidth, frame.frameHeight);
      if (baseline >= ZOOM_BASELINE_EPSILON) {
        this.zoomActive = true;
        this.zoomBaselineSeparation = baseline;
        this.zoomPrevRawRatio = 1;
        this.zoomLastRatio = 1;
        this.emitZoom("zoomstart", 1, frame.timestamp);
      }
      // else: degenerate baseline (hands on top of each other) -- retry next frame while still bothPinching.
      return;
    }

    if (bothPinching && this.zoomActive) {
      const a = identified.get(primary!)!;
      const b = identified.get(secondary!)!;
      const separation = this.handSeparation(a, b, frame.frameWidth, frame.frameHeight);

      let rawRatio = separation / this.zoomBaselineSeparation;
      if (!Number.isFinite(rawRatio) || rawRatio <= 0) rawRatio = this.zoomPrevRawRatio;

      if (Math.abs(rawRatio - 1) < ZOOM_DEAD_ZONE) rawRatio = 1;

      rawRatio = Math.min(
        this.zoomPrevRawRatio + ZOOM_MAX_RATIO_DELTA_PER_FRAME,
        Math.max(this.zoomPrevRawRatio - ZOOM_MAX_RATIO_DELTA_PER_FRAME, rawRatio),
      );
      this.zoomPrevRawRatio = rawRatio;

      const alpha = 1 - Math.exp(-dt / ZOOM_SMOOTHING_TAU_MS);
      let smoothed = this.zoomLastRatio + alpha * (rawRatio - this.zoomLastRatio);
      if (!Number.isFinite(smoothed) || smoothed <= 0) smoothed = 1;
      this.zoomLastRatio = smoothed;

      this.emitZoom("zoomchange", this.zoomLastRatio, frame.timestamp);
      return;
    }

    if (!bothPinching && this.zoomActive) {
      // Untracked-hand case is short-circuited to zoomcancel earlier in
      // update() (zoomActive would already be false by the time we get
      // here) -- reaching this branch means a normal hysteresis release.
      this.emitZoom("zoomend", this.zoomLastRatio, frame.timestamp);
      this.endZoomState();
    }
  }

  private endZoomState(): void {
    this.zoomActive = false;
    this.zoomBaselineSeparation = 0;
    this.zoomPrevRawRatio = 1;
    this.zoomLastRatio = 1;
  }

  private emitSelect(type: SelectEventType, point: ViewportPoint, timestamp: number): void {
    const event: SelectEvent = { type, point, timestamp };
    for (const cb of this.selectListeners) cb(event);
  }

  private emitZoom(type: TwoHandZoomEventType, ratio: number, timestamp: number): void {
    const event: TwoHandZoomEvent = { type, ratio, timestamp };
    for (const cb of this.zoomListeners) cb(event);
  }
}

export function createGestureProcessor(): GestureProcessor {
  return new GestureProcessorImpl();
}
