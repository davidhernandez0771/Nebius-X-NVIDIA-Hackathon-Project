// Integration layer (Agent 4): hit-testing, activation and drag adapters
// against the REAL app's controls, control-region + interaction-color
// persistence, dwell (hover) activation, and two-hand pinch-to-zoom
// context-gating -- wiring TrackingAdapter (Agent 1) through
// GestureProcessor (Agent 2) into the HandPointerApi Agent 3's overlay +
// calibration UI consume. See HAND_INTERACTION_PLAN.md (all revisions) and
// the JSDoc in ../contracts.ts, which is the actual spec for most of this.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURSOR_SHAPES,
  DEFAULT_CONTROL_REGION,
  DEFAULT_CURSOR_SHAPE,
  DEFAULT_INTERACTION_COLOR,
  DRAG_THRESHOLD_PX,
  DWELL_DURATION_MS,
  DWELL_ELIGIBLE_ATTR,
  DWELL_FAST_DURATION_MS,
  DWELL_JITTER_TOLERANCE_MS,
  INTERACTION_COLOR_CSS_VAR,
  type ControlRegion,
  type CursorShape,
  type DwellEvent,
  type DwellEventType,
  type GestureProcessor,
  type HandFrame,
  type HandPointerApi,
  type HandPointerPhase,
  type SelectEvent,
  type TrackingAdapter,
  type TrackingStatus,
  type TwoHandZoomEvent,
  type ViewportPoint,
} from "../contracts";
import { createMediapipeTracker } from "../tracking";
import { createGestureProcessor } from "../gesture";
import { getActiveScanViewer } from "./activeScanViewer";

// Nested icons/text inside these resolve to the control itself (closest()).
// `canvas` is included because ScanViewer's OrbitControls is the one
// existing drag surface in the app (see plan) -- it gets the dedicated
// PointerEvent adapter below instead of .click().
const INTERACTIVE_SELECTOR =
  'button, a[href], [role="button"], [role="radio"], [role="switch"], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), canvas';

// A dedicated, out-of-range pointerId so hand-driven synthetic pointer
// events can never be confused with a real mouse or touch pointer's id.
const HAND_POINTER_ID = -9001;

const CONTROL_REGION_STORAGE_KEY = "sant.hand.controlRegion";
const INTERACTION_COLOR_STORAGE_KEY = "sant.hand.interactionColor";
const CURSOR_SHAPE_STORAGE_KEY = "sant.hand.cursorShape";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
}

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function isModalOpen(): boolean {
  return document.querySelector('dialog[open], [role="dialog"]') !== null;
}

/**
 * Hit-testing: walk every element stacked under (x, y), resolve each to its
 * nearest interactive ancestor, and take the first result that's enabled
 * and visible. If a modal is open, stay inside it -- defensive; no modal
 * exists in the app today, so this path is untested.
 */
function resolveTarget(x: number, y: number): HTMLElement | null {
  const modal = document.querySelector<HTMLElement>('dialog[open], [role="dialog"]');
  for (const node of document.elementsFromPoint(x, y)) {
    if (modal && !modal.contains(node)) continue;
    const el = (node as HTMLElement).closest<HTMLElement>(INTERACTIVE_SELECTOR);
    if (el && !isDisabled(el) && isVisible(el)) return el;
  }
  return null;
}

function dispatchPointer(el: HTMLElement, type: string, point: ViewportPoint) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: HAND_POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    }),
  );
}

function distance(a: ViewportPoint, b: ViewportPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function loadControlRegion(): ControlRegion {
  try {
    const raw = localStorage.getItem(CONTROL_REGION_STORAGE_KEY);
    if (!raw) return DEFAULT_CONTROL_REGION;
    const parsed = JSON.parse(raw);
    return {
      centerX: typeof parsed.centerX === "number" ? parsed.centerX : DEFAULT_CONTROL_REGION.centerX,
      centerY: typeof parsed.centerY === "number" ? parsed.centerY : DEFAULT_CONTROL_REGION.centerY,
      width: typeof parsed.width === "number" ? parsed.width : DEFAULT_CONTROL_REGION.width,
      height: typeof parsed.height === "number" ? parsed.height : DEFAULT_CONTROL_REGION.height,
    };
  } catch {
    return DEFAULT_CONTROL_REGION;
  }
}

function saveControlRegion(region: ControlRegion): void {
  try {
    localStorage.setItem(CONTROL_REGION_STORAGE_KEY, JSON.stringify(region));
  } catch {
    // Private browsing / storage disabled / quota -- calibration just won't
    // persist across sessions. Not fatal, nothing else depends on this.
  }
}

function loadInteractionColor(): string {
  try {
    const raw = localStorage.getItem(INTERACTION_COLOR_STORAGE_KEY);
    return raw && HEX_COLOR_RE.test(raw) ? raw : DEFAULT_INTERACTION_COLOR;
  } catch {
    return DEFAULT_INTERACTION_COLOR;
  }
}

function saveInteractionColor(hex: string): void {
  try {
    localStorage.setItem(INTERACTION_COLOR_STORAGE_KEY, hex);
  } catch {
    // Same as control region -- non-fatal, just won't persist.
  }
}

function loadCursorShape(): CursorShape {
  try {
    const raw = localStorage.getItem(CURSOR_SHAPE_STORAGE_KEY);
    return raw && (CURSOR_SHAPES as readonly string[]).includes(raw) ? (raw as CursorShape) : DEFAULT_CURSOR_SHAPE;
  } catch {
    return DEFAULT_CURSOR_SHAPE;
  }
}

function saveCursorShape(shape: CursorShape): void {
  try {
    localStorage.setItem(CURSOR_SHAPE_STORAGE_KEY, shape);
  } catch {
    // Same as the other two settings -- non-fatal, just won't persist.
  }
}

interface PointerState {
  status: TrackingStatus;
  cursor: ViewportPoint | null;
  phase: HandPointerPhase;
  hoverTarget: HTMLElement | null;
  /** GestureProcessor.isSelecting, passed through unchanged every frame -- see the field's doc in contracts.ts. */
  isSelecting: boolean;
  twoHandZoom: { primaryPoint: ViewportPoint; secondaryPoint: ViewportPoint; ratio: number } | null;
  dwellTarget: HTMLElement | null;
  dwellProgress: number;
}

const IDLE_STATE: PointerState = {
  status: "idle",
  cursor: null,
  phase: "idle",
  hoverTarget: null,
  isSelecting: false,
  twoHandZoom: null,
  dwellTarget: null,
  dwellProgress: 0,
};

export function useHandPointer(): HandPointerApi {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<PointerState>(IDLE_STATE);
  const [controlRegion, setControlRegionState] = useState<ControlRegion>(() => loadControlRegion());
  const [interactionColor, setInteractionColorState] = useState<string>(() => loadInteractionColor());
  const [cursorShape, setCursorShapeState] = useState<CursorShape>(() => loadCursorShape());

  const adapterRef = useRef<TrackingAdapter | null>(null);
  const gestureRef = useRef<GestureProcessor | null>(null);
  const capturedTargetRef = useRef<HTMLElement | null>(null);
  const selectStartPointRef = useRef<ViewportPoint | null>(null);
  const draggingCanvasRef = useRef(false);
  const lastPointRef = useRef<ViewportPoint>({ x: 0, y: 0 });
  const hoverTargetRef = useRef<HTMLElement | null>(null); // live, unlike state.hoverTarget which can be read stale in a closure
  const controlRegionRef = useRef<ControlRegion>(controlRegion);

  const zoomActiveRef = useRef(false); // currently applying ratios to the viewer
  const zoomBaselineDistanceRef = useRef(0);

  const dwellListenersRef = useRef(new Set<(event: DwellEvent) => void>());
  const dwellTargetRef = useRef<HTMLElement | null>(null); // committed target accumulating time
  // Rate-based progress (Revision 5): a single accumulator + the timestamp of
  // its last integration step, NOT a start timestamp -- the rate (normal vs.
  // accelerated) can change mid-dwell, so progress can no longer be derived
  // as a single (now - start) / duration division. See the DWELL doc.
  const dwellProgressRef = useRef(0);
  const dwellLastTickRef = useRef<number | null>(null);
  const dwellPendingRef = useRef<{ target: HTMLElement | null; since: number } | null>(null);
  const dwellRearmBlockedTargetRef = useRef<HTMLElement | null>(null); // "must leave before it can fire again"

  // Live mirrors of state.phase/state.cursor, kept in lockstep with every
  // setState(...phase.../...cursor...) call below. Needed because dwell
  // eligibility must react to the CURRENT phase (armed/dragging/zooming all
  // block it) inside handleFrame, which runs synchronously with the state
  // update that decides phase for this same frame -- reading `state` in
  // that closure would be one frame stale.
  const phaseRef = useRef<HandPointerPhase>("idle");
  const cursorRef = useRef<ViewportPoint | null>(null);

  const setPhase = useCallback((phase: HandPointerPhase) => {
    phaseRef.current = phase;
    setState((s) => (s.phase === phase ? s : { ...s, phase }));
  }, []);

  // Ends an in-flight canvas drag. pointercancel, not pointerup, since the
  // gesture was aborted, not completed -- OrbitControls treats both as
  // "stop dragging".
  const endCanvasDrag = useCallback((point: ViewportPoint) => {
    const target = capturedTargetRef.current;
    if (target && draggingCanvasRef.current) {
      dispatchPointer(target, "pointercancel", point);
    }
    draggingCanvasRef.current = false;
  }, []);

  const endTwoHandZoom = useCallback(() => {
    if (!zoomActiveRef.current) return;
    zoomActiveRef.current = false;
    getActiveScanViewer()?.setOrbitEnabled(true);
    setPhase(cursorRef.current ? "pointing" : "idle");
    setState((s) => ({ ...s, twoHandZoom: null }));
  }, [setPhase]);

  const abortGesture = useCallback(
    (point: ViewportPoint) => {
      endCanvasDrag(point);
      endTwoHandZoom();
      capturedTargetRef.current = null;
      selectStartPointRef.current = null;
    },
    [endCanvasDrag, endTwoHandZoom],
  );

  const emitDwellEvent = useCallback((type: DwellEventType, target: HTMLElement, timestamp: number) => {
    const event: DwellEvent = { type, target, timestamp };
    dwellListenersRef.current.forEach((cb) => cb(event));
  }, []);

  // Hard-cancels dwell immediately (bypasses the jitter-tolerance debounce
  // below, which is only for ordinary cursor movement) -- used for tracking
  // loss, another gesture starting, a modal opening, disable(), and tab
  // visibility changes. All are discrete "something else is happening now"
  // events, not noise to tolerate.
  const cancelDwell = useCallback(
    (now: number) => {
      const target = dwellTargetRef.current;
      dwellPendingRef.current = null;
      dwellTargetRef.current = null;
      dwellProgressRef.current = 0;
      dwellLastTickRef.current = null;
      if (target) {
        emitDwellEvent("dwellcancel", target, now);
        setState((s) => (s.dwellTarget ? { ...s, dwellTarget: null, dwellProgress: 0 } : s));
      }
    },
    [emitDwellEvent],
  );

  // The one logical dwell timer (Revision 5: normal hover PLUS accelerated
  // selection on the same target -- see the DWELL doc in contracts.ts for
  // the full spec this implements). Called every tracked frame from
  // handleFrame, using real elapsed time (frame.timestamp), not a separate
  // setInterval/rAF loop. Progress here is what the overlay's perimeter
  // animation renders -- the animation never independently decides to
  // activate anything.
  const updateDwell = useCallback(
    (now: number, hoverTarget: HTMLElement | null, phaseIsPointing: boolean, isTracking: boolean, isSelecting: boolean) => {
      const eligibleNow = isTracking && phaseIsPointing && !isModalOpen();
      if (!eligibleNow) {
        cancelDwell(now);
        return;
      }

      if (dwellRearmBlockedTargetRef.current && hoverTarget !== dwellRearmBlockedTargetRef.current) {
        dwellRearmBlockedTargetRef.current = null; // left the just-activated target -- may dwell again elsewhere, or on it later
      }

      let rawTarget: HTMLElement | null = null;
      if (
        hoverTarget &&
        hoverTarget !== dwellRearmBlockedTargetRef.current &&
        hoverTarget.hasAttribute(DWELL_ELIGIBLE_ATTR) &&
        hoverTarget.isConnected &&
        !isDisabled(hoverTarget) &&
        isVisible(hoverTarget)
      ) {
        rawTarget = hoverTarget;
      }

      const committed = dwellTargetRef.current;

      if (rawTarget !== committed) {
        if (committed === null) {
          // Starting fresh: nothing accumulated yet to protect from jitter,
          // so commit immediately -- delaying the ONSET of dwell by the
          // jitter-tolerance window as well would just make it feel laggy
          // to start, which isn't what that tolerance is for.
          dwellPendingRef.current = null;
          dwellTargetRef.current = rawTarget;
          dwellProgressRef.current = 0;
          dwellLastTickRef.current = rawTarget ? now : null;
          if (rawTarget) emitDwellEvent("dwellstart", rawTarget, now);
          setState((s) => ({ ...s, dwellTarget: rawTarget, dwellProgress: 0 }));
          return;
        }

        // Already dwelling on `committed` and the raw reading now differs
        // (including reading null, e.g. a one-frame tracking blip) --
        // debounce against jitter: only actually switch once the new
        // reading has held for DWELL_JITTER_TOLERANCE_MS. Progress keeps
        // accumulating against the OLD committed target below while
        // pending -- never transferred to the new one.
        const pending = dwellPendingRef.current;
        if (!pending || pending.target !== rawTarget) {
          dwellPendingRef.current = { target: rawTarget, since: now };
        } else if (now - pending.since >= DWELL_JITTER_TOLERANCE_MS) {
          dwellPendingRef.current = null;
          emitDwellEvent("dwellcancel", committed, now);
          dwellTargetRef.current = rawTarget;
          dwellProgressRef.current = 0;
          dwellLastTickRef.current = rawTarget ? now : null;
          if (rawTarget) emitDwellEvent("dwellstart", rawTarget, now);
          setState((s) => ({ ...s, dwellTarget: rawTarget, dwellProgress: 0 }));
          return;
        }
        // else: still within the tolerance window -- fall through and keep
        // integrating progress against `committed` this frame.
      } else {
        dwellPendingRef.current = null;
      }

      if (committed) {
        // Rate-based integration (Revision 5): one accumulator, advanced by
        // dt/duration every frame, where duration depends on THIS frame's
        // isSelecting -- not a single elapsed/duration division. This is
        // what lets the rate change mid-dwell (fingers together/apart)
        // without resetting or jumping the accumulated progress.
        const dt = now - (dwellLastTickRef.current ?? now);
        dwellLastTickRef.current = now;
        const duration = isSelecting ? DWELL_FAST_DURATION_MS : DWELL_DURATION_MS;
        const progress = Math.min(1, dwellProgressRef.current + dt / duration);
        dwellProgressRef.current = progress;
        setState((s) => (s.dwellProgress === progress ? s : { ...s, dwellProgress: progress }));
        if (progress >= 1) {
          dwellTargetRef.current = null;
          dwellProgressRef.current = 0;
          dwellLastTickRef.current = null;
          dwellRearmBlockedTargetRef.current = committed; // require leaving before it can fire again
          emitDwellEvent("dwellactivate", committed, now);
          setState((s) => ({ ...s, dwellTarget: null, dwellProgress: 0 }));
          if (committed.isConnected && !isDisabled(committed) && isVisible(committed)) {
            committed.click();
          }
        }
      }
    },
    [cancelDwell, emitDwellEvent],
  );

  const handleSelectEvent = useCallback(
    (event: SelectEvent) => {
      const { type, point } = event;

      if (type === "selectstart") {
        // Capture on select-start -- never re-resolve at release.
        const target = resolveTarget(point.x, point.y);

        // Revision 5: a dwell-eligible target absorbs this gesture entirely
        // via accelerated dwell (see the DWELL doc in contracts.ts) -- no
        // capture, no phase change, no click/drag pipeline. isSelecting
        // (read fresh from GestureProcessor every frame) still drives
        // cursor visuals and dwell's rate; dwell's own timer is the only
        // activation path for this target. This is what makes "release
        // after dwell activation must not click again" true by
        // construction: there is simply no captured target for the
        // ordinary release-to-click handler below to ever act on.
        if (target && target.hasAttribute(DWELL_ELIGIBLE_ATTR)) return;

        capturedTargetRef.current = target;
        selectStartPointRef.current = point;
        if (target && target.tagName === "CANVAS") {
          // Canvas (ScanViewer's OrbitControls) has no click semantic -- a
          // select-down on it starts the drag immediately rather than
          // waiting for DRAG_THRESHOLD_PX, since there's nothing else it
          // could mean.
          draggingCanvasRef.current = true;
          dispatchPointer(target, "pointerdown", point);
        }
        if (target) setPhase("armed");
        return;
      }

      if (type === "selectmove") {
        const target = capturedTargetRef.current;
        const start = selectStartPointRef.current;
        if (!target || !start) return; // nothing captured at selectstart -> ignore

        if (draggingCanvasRef.current) {
          dispatchPointer(target, "pointermove", point);
          return;
        }

        // Only the canvas gets drag treatment. For every other control,
        // crossing the threshold just cancels the eventual click (below) --
        // it does not start dragging anything.
        if (distance(point, start) > DRAG_THRESHOLD_PX) {
          setPhase("dragging");
        }
        return;
      }

      if (type === "selectend") {
        const target = capturedTargetRef.current;
        const start = selectStartPointRef.current;
        const wasDraggingCanvas = draggingCanvasRef.current;

        if (wasDraggingCanvas && target) {
          dispatchPointer(target, "pointerup", point);
        } else if (target && start && distance(point, start) <= DRAG_THRESHOLD_PX) {
          // Activate only on a valid release that never became a drag, and
          // only if the captured target is still real.
          if (target.isConnected && !isDisabled(target) && isVisible(target)) {
            target.click();
          }
        }

        draggingCanvasRef.current = false;
        capturedTargetRef.current = null;
        selectStartPointRef.current = null;
        setPhase(cursorRef.current ? "pointing" : "idle");
        return;
      }

      // "cancel": either tracking lost mid-select, or GestureProcessor's own
      // select/pinch priority rule preempted an in-progress select because
      // the primary hand started pinching (see contracts.ts). Either way,
      // abandon cleanly -- no click, no drag continuation. No extra
      // "suppress until release" bookkeeping is needed here: GestureProcessor
      // itself won't start a new select on this hand while it's pinching, so
      // there's nothing left to guard against once this cancel is consumed.
      abortGesture(point);
      setPhase(cursorRef.current ? "pointing" : "idle");
    },
    [abortGesture, setPhase],
  );

  // Two-hand pinch-to-zoom. GestureProcessor's zoom events are context-free
  // (fire whenever both identified hands are pinching, regardless of what's
  // on screen) -- gating to "only when the room viewer is the active
  // context" happens entirely here, using the LIVE hover target (not a
  // captured select target -- select and pinch are independent gestures as
  // of Revision 4, so there is no select-capture to key zoom's context off
  // of; hoverTargetRef is read instead, kept live every frame).
  const handleZoomEvent = useCallback(
    (event: TwoHandZoomEvent) => {
      if (event.type === "zoomstart") {
        const target = hoverTargetRef.current;
        if (!target || target.tagName !== "CANVAS") return; // wrong context -- ignore entirely, one-hand behavior is untouched
        const viewer = getActiveScanViewer();
        if (!viewer) return;

        // Defensive: end any one-hand drag already in flight on the canvas.
        // In practice GestureProcessor's select/pinch priority rule should
        // already have cancelled it before pinch could engage, but this is
        // a cheap, idempotent safety net either way.
        endCanvasDrag(lastPointRef.current);
        zoomActiveRef.current = true;
        zoomBaselineDistanceRef.current = viewer.getDistance();
        viewer.setOrbitEnabled(false);
        cancelDwell(event.timestamp); // "another gesture begins" cancels pending dwell
        setPhase("zooming");

        const gesture = gestureRef.current;
        setState((s) => ({
          ...s,
          twoHandZoom:
            gesture?.cursor && gesture?.secondaryCursor
              ? { primaryPoint: gesture.cursor, secondaryPoint: gesture.secondaryCursor, ratio: event.ratio }
              : s.twoHandZoom,
        }));
        return;
      }

      if (event.type === "zoomchange") {
        if (!zoomActiveRef.current) return; // wasn't a valid context at zoomstart -- ignore the whole gesture
        const viewer = getActiveScanViewer();
        const gesture = gestureRef.current;
        if (viewer && zoomBaselineDistanceRef.current > 0) {
          // Hands apart (ratio > 1) -> zoom IN -> smaller camera distance.
          viewer.setDistance(zoomBaselineDistanceRef.current / event.ratio);
        }
        setState((s) => ({
          ...s,
          twoHandZoom:
            gesture?.cursor && gesture?.secondaryCursor
              ? { primaryPoint: gesture.cursor, secondaryPoint: gesture.secondaryCursor, ratio: event.ratio }
              : s.twoHandZoom,
        }));
        return;
      }

      // zoomend / zoomcancel: end safely at the last valid view (we simply
      // stop applying further changes -- the viewer is already at the last
      // setDistance() call's value). Re-enable orbit/mouse controls.
      endTwoHandZoom();
    },
    [endCanvasDrag, endTwoHandZoom, cancelDwell, setPhase],
  );

  const handleFrame = useCallback(
    (frame: HandFrame) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gesture.update(frame);

      const cursor = gesture.cursor;
      cursorRef.current = cursor;
      if (cursor) lastPointRef.current = cursor;
      const hoverTarget = cursor ? resolveTarget(cursor.x, cursor.y) : null;
      hoverTargetRef.current = hoverTarget;
      // The confirmed gesture state, passed straight through every frame --
      // see the isSelecting doc on HandPointerState. Never recomputed
      // independently here; always read from GestureProcessor.
      const isSelecting = gesture.isSelecting;

      // Only the idle<->pointing edge is decided here; armed/dragging/
      // zooming is owned by the select/zoom-event handlers (via setPhase)
      // so a frame arriving mid-gesture never downgrades it -- phaseRef is
      // the live source of truth for "is a gesture currently in progress",
      // read fresh here rather than trusting React state in this closure.
      const phase: HandPointerPhase = cursor === null ? "idle" : phaseRef.current === "idle" ? "pointing" : phaseRef.current;
      phaseRef.current = phase;

      setState((s) => ({
        ...s,
        cursor,
        hoverTarget,
        phase,
        isSelecting,
        // Keep the zoom markers' positions live between zoomchange events
        // too (cursor/secondaryCursor update every tracked frame, not
        // just on select/zoom lifecycle events).
        twoHandZoom:
          zoomActiveRef.current && gesture.cursor && gesture.secondaryCursor
            ? {
                primaryPoint: gesture.cursor,
                secondaryPoint: gesture.secondaryCursor,
                ratio: gesture.zoomRatio ?? s.twoHandZoom?.ratio ?? 1,
              }
            : s.twoHandZoom,
      }));

      // Dwell runs off this same per-frame update -- see updateDwell's doc.
      // Only progresses while genuinely "pointing" (not idle, armed,
      // dragging, or zooming); isSelecting picks the accelerated rate.
      updateDwell(frame.timestamp, hoverTarget, phase === "pointing", cursor !== null, isSelecting);
    },
    [updateDwell],
  );

  const handleStatus = useCallback(
    (status: TrackingStatus) => {
      setState((s) => ({ ...s, status }));
      if (status === "error") {
        // Frames stopped arriving entirely (STALE_FRAME_MS watchdog).
        // GestureProcessor.update() is never called again to notice this on
        // its own (it only sees HandFrames) -- reset it and abort any
        // in-flight gesture/drag/zoom/dwell here instead.
        gestureRef.current?.reset();
        abortGesture(lastPointRef.current);
        cancelDwell(performance.now());
        phaseRef.current = "idle";
        cursorRef.current = null;
        hoverTargetRef.current = null;
        setState((s) => ({ ...s, cursor: null, hoverTarget: null, phase: "idle", isSelecting: false, twoHandZoom: null }));
      }
    },
    [abortGesture, cancelDwell],
  );

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "hidden") {
      cancelDwell(performance.now());
    }
  }, [cancelDwell]);

  const enable = useCallback(async () => {
    if (adapterRef.current) return; // already enabled
    setEnabled(true);
    const adapter = createMediapipeTracker();
    const gesture = createGestureProcessor();
    adapterRef.current = adapter;
    gestureRef.current = gesture;
    gesture.setControlRegion(controlRegionRef.current);
    adapter.onFrame(handleFrame);
    adapter.onStatus(handleStatus);
    gesture.onSelectEvent(handleSelectEvent);
    gesture.onZoomEvent(handleZoomEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    try {
      await adapter.start();
    } catch {
      // start() already drove status to "error" internally; nothing else to do.
    }
  }, [handleFrame, handleStatus, handleSelectEvent, handleZoomEvent, handleVisibilityChange]);

  // Disabling fully releases camera + model (cleanup(), not stop()) and
  // tears down any in-flight gesture, drag, zoom, or dwell -- not just
  // hides the UI.
  const disable = useCallback(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    abortGesture(lastPointRef.current);
    cancelDwell(performance.now());
    dwellRearmBlockedTargetRef.current = null;
    phaseRef.current = "idle";
    cursorRef.current = null;
    hoverTargetRef.current = null;
    adapterRef.current?.cleanup();
    adapterRef.current = null;
    gestureRef.current?.reset();
    gestureRef.current = null;
    setEnabled(false);
    setState(IDLE_STATE);
  }, [abortGesture, cancelDwell, handleVisibilityChange]);

  // Release camera/model on unmount even if the user never explicitly
  // disabled. The overlay is mounted for the app's lifetime, so in practice
  // this only fires on a hard reload/navigation away from the whole app,
  // but it's the correct safety net.
  useEffect(() => {
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      getActiveScanViewer()?.setOrbitEnabled(true);
      adapterRef.current?.cleanup();
      adapterRef.current = null;
    };
  }, [handleVisibilityChange]);

  // Region changes are queued by GestureProcessor itself while a gesture is
  // in progress (see contracts.ts) -- this just merges, persists, and
  // forwards. Safe to call at any time.
  const setControlRegion = useCallback((patch: Partial<ControlRegion>) => {
    setControlRegionState((prev) => {
      const next = { ...prev, ...patch };
      controlRegionRef.current = next;
      saveControlRegion(next);
      gestureRef.current?.setControlRegion(next);
      return next;
    });
  }, []);

  const resetControlRegion = useCallback(() => {
    controlRegionRef.current = DEFAULT_CONTROL_REGION;
    setControlRegionState(DEFAULT_CONTROL_REGION);
    saveControlRegion(DEFAULT_CONTROL_REGION);
    gestureRef.current?.setControlRegion(DEFAULT_CONTROL_REGION);
  }, []);

  const onDwellEvent = useCallback((cb: (event: DwellEvent) => void) => {
    dwellListenersRef.current.add(cb);
    return () => {
      dwellListenersRef.current.delete(cb);
    };
  }, []);

  // Applies to document.documentElement so it's a single global style write
  // -- independent of camera/tracking lifecycle entirely, so it can never
  // restart the camera, reset tracking, or interrupt dwell progress.
  useEffect(() => {
    document.documentElement.style.setProperty(INTERACTION_COLOR_CSS_VAR, interactionColor);
  }, [interactionColor]);

  const setInteractionColor = useCallback((hex: string) => {
    if (!HEX_COLOR_RE.test(hex)) return;
    setInteractionColorState(hex);
    saveInteractionColor(hex);
  }, []);

  const resetInteractionColor = useCallback(() => {
    setInteractionColorState(DEFAULT_INTERACTION_COLOR);
    saveInteractionColor(DEFAULT_INTERACTION_COLOR);
  }, []);

  // Purely a rendering choice for Agent 3's cursor dot -- no DOM/CSS-variable
  // side effect needed here (unlike color), just persistence + exposure.
  const setCursorShape = useCallback((shape: CursorShape) => {
    setCursorShapeState(shape);
    saveCursorShape(shape);
  }, []);

  const resetCursorShape = useCallback(() => {
    setCursorShapeState(DEFAULT_CURSOR_SHAPE);
    saveCursorShape(DEFAULT_CURSOR_SHAPE);
  }, []);

  return {
    ...state,
    enabled,
    enable,
    disable,
    controlRegion,
    setControlRegion,
    resetControlRegion,
    onDwellEvent,
    interactionColor,
    setInteractionColor,
    resetInteractionColor,
    cursorShape,
    setCursorShape,
    resetCursorShape,
  };
}
