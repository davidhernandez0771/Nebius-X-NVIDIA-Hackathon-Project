// Integration-layer tests (Agent 4): hit-testing/activation via the SELECT
// gesture, two-hand zoom context-gating (now keyed on live hover, not a
// select capture), dwell (hover) activation on eligible targets, and
// control-region/interaction-color persistence. TrackingAdapter and
// GestureProcessor are mocked so this tests only the integration layer's
// own decisions, not MediaPipe or the real gesture math (those are Agent
// 1's and Agent 2's own test suites).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ScanViewerHandle } from "../../three/ScanViewer";
import {
  DWELL_DURATION_MS,
  DWELL_ELIGIBLE_ATTR,
  DWELL_FAST_DURATION_MS,
  DWELL_JITTER_TOLERANCE_MS,
  type CursorShape,
  type DwellEvent,
  type HandFrame,
  type SelectEvent,
  type TrackingStatus,
  type TwoHandZoomEvent,
  type ViewportPoint,
} from "../contracts";
import { registerScanViewer } from "./activeScanViewer";

type FrameCb = (frame: HandFrame) => void;
type StatusCb = (status: TrackingStatus) => void;
type SelectCb = (event: SelectEvent) => void;
type ZoomCb = (event: TwoHandZoomEvent) => void;

let frameCbs: FrameCb[];
let statusCbs: StatusCb[];
let selectCbs: SelectCb[];
let zoomCbs: ZoomCb[];
let mockCursor: ViewportPoint | null;
let mockSecondaryCursor: ViewportPoint | null;
let mockZoomRatio: number | null;
let mockIsSelecting: boolean;
let startSpy: ReturnType<typeof vi.fn>;
let cleanupSpy: ReturnType<typeof vi.fn>;
let setControlRegionSpy: ReturnType<typeof vi.fn>;

vi.mock("../tracking", () => ({
  createMediapipeTracker: () => ({
    start: startSpy,
    stop: vi.fn(),
    cleanup: cleanupSpy,
    onFrame: (cb: FrameCb) => {
      frameCbs.push(cb);
      return () => {};
    },
    onStatus: (cb: StatusCb) => {
      statusCbs.push(cb);
      return () => {};
    },
  }),
}));

vi.mock("../gesture", () => ({
  createGestureProcessor: () => ({
    update: vi.fn(),
    reset: vi.fn(),
    setControlRegion: setControlRegionSpy,
    get cursor() {
      return mockCursor;
    },
    get secondaryCursor() {
      return mockSecondaryCursor;
    },
    get isSelecting() {
      return mockIsSelecting;
    },
    get zoomRatio() {
      return mockZoomRatio;
    },
    onSelectEvent: (cb: SelectCb) => {
      selectCbs.push(cb);
      return () => {};
    },
    onZoomEvent: (cb: ZoomCb) => {
      zoomCbs.push(cb);
      return () => {};
    },
  }),
}));

// Imported after the mocks above so the module picks them up.
const { useHandPointer } = await import("./useHandPointer");

let now = 1_000_000; // arbitrary monotonic base; advanced explicitly per test

function fireFrame(frame: Partial<HandFrame> = {}) {
  const full: HandFrame = { timestamp: now, hands: [], frameWidth: 640, frameHeight: 480, ...frame };
  frameCbs.forEach((cb) => cb(full));
}
function fireStatus(status: TrackingStatus) {
  statusCbs.forEach((cb) => cb(status));
}
function fireSelect(type: SelectEvent["type"], point: ViewportPoint = { x: 100, y: 100 }) {
  selectCbs.forEach((cb) => cb({ type, point, timestamp: now }));
}
function fireZoom(type: TwoHandZoomEvent["type"], ratio = 1) {
  zoomCbs.forEach((cb) => cb({ type, ratio, timestamp: now }));
}
function advance(ms: number) {
  now += ms;
}

function makeViewer(): ScanViewerHandle & { distance: number } {
  const handle = {
    distance: 8,
    getDistance() {
      return handle.distance;
    },
    setDistance(d: number) {
      handle.distance = d;
    },
    minDistance: 2.5,
    maxDistance: 16,
    setOrbitEnabled: vi.fn(),
  };
  return handle;
}

// jsdom doesn't implement elementsFromPoint at all (the property doesn't
// exist on the prototype), so vi.spyOn can't wrap it -- assign a stub
// directly instead, overridden per test as needed.
function stubElementsFromPoint(elements: Element[]) {
  document.elementsFromPoint = vi.fn().mockReturnValue(elements);
}

function expectCloseTo(actual: number, expected: number, tolerance = 0.05) {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

// jsdom does no real layout, so offsetParent is always null and
// getClientRects() always empty -- useHandPointer's isVisible() check
// would filter every element out. Give test elements a fake non-empty
// rect so they read as visible, same as they would in a real browser.
function makeVisible(el: HTMLElement) {
  el.getClientRects = () => [{ width: 10, height: 10 } as DOMRect] as unknown as DOMRectList;
}

function makeDwellIcon(): HTMLElement {
  const el = document.createElement("a");
  el.href = "#"; // matches the hit-testing selector (a[href]), same as a real IconTile Link; a fragment avoids jsdom's "navigation not implemented" noise on .click()
  el.setAttribute(DWELL_ELIGIBLE_ATTR, "true");
  document.body.appendChild(el);
  makeVisible(el);
  return el;
}

beforeEach(() => {
  frameCbs = [];
  statusCbs = [];
  selectCbs = [];
  zoomCbs = [];
  mockCursor = { x: 50, y: 50 };
  mockSecondaryCursor = { x: 150, y: 150 };
  mockZoomRatio = null;
  mockIsSelecting = false;
  startSpy = vi.fn().mockResolvedValue(undefined);
  cleanupSpy = vi.fn();
  setControlRegionSpy = vi.fn();
  document.body.innerHTML = "";
  stubElementsFromPoint([]);
  document.documentElement.style.removeProperty("--hand-interaction-color");
  localStorage.clear();
  now = 1_000_000;
});

afterEach(() => {
  registerScanViewer(null);
  vi.restoreAllMocks();
});

describe("select gesture: hit-testing, click, drag", () => {
  it("captures on selectstart and clicks on a clean release", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);
    stubElementsFromPoint([button]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    expect(result.current.phase).toBe("armed");
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("pointing");
  });

  it("moving past the drag threshold cancels the eventual click on non-canvas targets", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);
    stubElementsFromPoint([button]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    act(() => fireSelect("selectmove", { x: 400, y: 400 }));
    expect(result.current.phase).toBe("dragging");
    act(() => fireSelect("selectend", { x: 400, y: 400 }));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("drives the canvas via PointerEvents instead of .click()", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    makeVisible(canvas);
    const clickSpy = vi.fn();
    const downSpy = vi.fn();
    const upSpy = vi.fn();
    canvas.addEventListener("click", clickSpy);
    canvas.addEventListener("pointerdown", downSpy);
    canvas.addEventListener("pointerup", upSpy);
    stubElementsFromPoint([canvas]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    expect(downSpy).toHaveBeenCalledTimes(1);
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(upSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled(); // canvas has no click semantic
  });

  it("a select 'cancel' (e.g. preempted by pinch, per GestureProcessor's priority rule) aborts cleanly with no click", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);
    stubElementsFromPoint([button]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame()); // populates state.cursor, needed for the phase assertion below
    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    act(() => fireSelect("cancel", { x: 10, y: 10 }));
    expect(clickSpy).not.toHaveBeenCalled();

    // A genuinely new select afterwards behaves normally -- no leftover suppression.
    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("pointing");
  });
});

describe("two-hand zoom context-gating (keyed on live hover, not a select capture)", () => {
  it("applies zoom to the viewer only when the cursor is currently hovering a <canvas>", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    makeVisible(canvas);
    stubElementsFromPoint([canvas]);

    const viewer = makeViewer();
    registerScanViewer(viewer);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame()); // populates the live hover target via resolveTarget
    act(() => fireZoom("zoomstart", 1));

    expect(viewer.setOrbitEnabled).toHaveBeenCalledWith(false);
    expect(result.current.phase).toBe("zooming");

    act(() => fireZoom("zoomchange", 2)); // hands apart -> zoom in -> smaller distance
    expect(viewer.distance).toBeCloseTo(8 / 2);

    act(() => fireZoom("zoomchange", 0.5)); // together -> zoom out -> larger distance
    expect(viewer.distance).toBeCloseTo(8 / 0.5);
  });

  it("ignores zoom events entirely when the cursor is hovering an ordinary button, not the canvas", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);
    stubElementsFromPoint([button]);

    const viewer = makeViewer();
    registerScanViewer(viewer);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    act(() => fireZoom("zoomstart", 1));

    expect(viewer.setOrbitEnabled).not.toHaveBeenCalled();
    expect(result.current.phase).not.toBe("zooming");

    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("ends zoom safely and re-enables orbit on zoomcancel (tracking loss)", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    makeVisible(canvas);
    stubElementsFromPoint([canvas]);
    const viewer = makeViewer();
    registerScanViewer(viewer);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    act(() => fireZoom("zoomstart", 1));
    act(() => fireZoom("zoomchange", 1.5));
    act(() => fireZoom("zoomcancel", 1.5));

    expect(viewer.setOrbitEnabled).toHaveBeenLastCalledWith(true);
    expect(result.current.twoHandZoom).toBeNull();
  });
});

describe("dwell (hover) activation", () => {
  it("activates after DWELL_DURATION_MS of continuous hover on an eligible target, exactly once", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const clickSpy = vi.fn();
    icon.addEventListener("click", clickSpy);
    const events: DwellEvent["type"][] = [];

    const { result } = renderHook(() => useHandPointer());
    result.current.onDwellEvent((e) => events.push(e.type));
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    expect(result.current.dwellTarget).toBe(icon);
    expect(events).toEqual(["dwellstart"]);

    advance(DWELL_DURATION_MS / 2);
    act(() => fireFrame());
    expect(result.current.dwellProgress).toBeCloseTo(0.5, 1);
    expect(clickSpy).not.toHaveBeenCalled();

    advance(DWELL_DURATION_MS / 2 + 10);
    act(() => fireFrame());
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.dwellTarget).toBeNull();
    expect(events).toEqual(["dwellstart", "dwellactivate"]);

    // Holding on the same target afterwards must not fire again.
    advance(DWELL_DURATION_MS * 2);
    act(() => fireFrame());
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("requires leaving the target before it can dwell-activate again", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const clickSpy = vi.fn();
    icon.addEventListener("click", clickSpy);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS + 10);
    act(() => fireFrame());
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Cursor leaves (nothing under it), then returns to the same icon.
    stubElementsFromPoint([]);
    advance(DWELL_JITTER_TOLERANCE_MS + 10);
    act(() => fireFrame());
    stubElementsFromPoint([icon]);
    advance(DWELL_JITTER_TOLERANCE_MS + 10);
    act(() => fireFrame());
    advance(DWELL_DURATION_MS + 10);
    act(() => fireFrame());
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it("does not activate on a non-eligible element even after a long hover", async () => {
    const button = document.createElement("button"); // no DWELL_ELIGIBLE_ATTR
    document.body.appendChild(button);
    makeVisible(button);
    stubElementsFromPoint([button]);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 2);
    act(() => fireFrame());
    expect(clickSpy).not.toHaveBeenCalled();
    expect(result.current.dwellTarget).toBeNull();
  });

  it("tolerates brief target flicker without resetting progress, but never activates the flickered-to target", async () => {
    const iconA = makeDwellIcon();
    const iconB = makeDwellIcon();
    const clickA = vi.fn();
    const clickB = vi.fn();
    iconA.addEventListener("click", clickA);
    iconB.addEventListener("click", clickB);

    stubElementsFromPoint([iconA]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.8);
    act(() => fireFrame());
    const progressBeforeFlicker = result.current.dwellProgress;

    // One-frame flicker to iconB, well under the jitter tolerance window.
    stubElementsFromPoint([iconB]);
    advance(10);
    act(() => fireFrame());
    stubElementsFromPoint([iconA]);
    advance(10);
    act(() => fireFrame());

    expect(result.current.dwellTarget).toBe(iconA); // never switched
    expect(result.current.dwellProgress).toBeGreaterThanOrEqual(progressBeforeFlicker);

    advance(DWELL_DURATION_MS * 0.3);
    act(() => fireFrame());
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(clickB).not.toHaveBeenCalled();
  });

  it("switches target after the flicker holds past the jitter tolerance window", async () => {
    const iconA = makeDwellIcon();
    const iconB = makeDwellIcon();

    stubElementsFromPoint([iconA]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.5);
    act(() => fireFrame());

    stubElementsFromPoint([iconB]);
    advance(10); // first sighting of iconB -- starts the pending-switch window
    act(() => fireFrame());
    expect(result.current.dwellTarget).toBe(iconA); // not yet -- tolerance window still open

    advance(DWELL_JITTER_TOLERANCE_MS + 10); // let the tolerance window elapse
    act(() => fireFrame());

    expect(result.current.dwellTarget).toBe(iconB);
    expect(result.current.dwellProgress).toBe(0); // fresh start, no credit carried over
  });

  it("cancels on tracking loss (status -> error)", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const events: DwellEvent["type"][] = [];

    const { result } = renderHook(() => useHandPointer());
    result.current.onDwellEvent((e) => events.push(e.type));
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    expect(result.current.dwellTarget).toBe(icon);
    act(() => fireStatus("error"));
    expect(result.current.dwellTarget).toBeNull();
    expect(events).toEqual(["dwellstart", "dwellcancel"]);
  });

  it("cancels when a DIFFERENT (non-dwell) target's select gesture begins, and produces at most one action", async () => {
    // Revision 5 superseded "select cancels dwell on the SAME target" --
    // this covers the case that's still correct: the hand moved to select
    // something else entirely, which does leave "pointing" and must still
    // cancel any pending dwell.
    const icon = makeDwellIcon();
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const iconClickSpy = vi.fn();
    const buttonClickSpy = vi.fn();
    icon.addEventListener("click", iconClickSpy);
    button.addEventListener("click", buttonClickSpy);

    stubElementsFromPoint([icon]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.9);
    act(() => fireFrame());
    expect(result.current.dwellTarget).toBe(icon);

    stubElementsFromPoint([button]); // hand moved elsewhere first
    act(() => fireSelect("selectstart", { x: 300, y: 300 }));
    act(() => fireFrame()); // phase is now "armed" on the button, dwell must not progress/activate
    expect(result.current.dwellTarget).toBeNull();

    act(() => fireSelect("selectend", { x: 300, y: 300 }));
    expect(buttonClickSpy).toHaveBeenCalledTimes(1); // the manual select's own click
    expect(iconClickSpy).not.toHaveBeenCalled(); // dwell never completed
  });

  it("Revision 5: fingers together on the SAME dwell target accelerates instead of cancelling, and never double-activates via the click handler", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const clickSpy = vi.fn();
    icon.addEventListener("click", clickSpy);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.3);
    act(() => fireFrame());
    const progressBefore = result.current.dwellProgress;

    // Fingers come together over the SAME target: selectstart is absorbed
    // entirely (no capture -- see contracts.ts), phase stays "pointing",
    // dwell keeps the same target and does not reset.
    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    expect(result.current.phase).toBe("pointing");
    expect(result.current.dwellTarget).toBe(icon);
    expect(result.current.dwellProgress).toBe(progressBefore); // no jump/reset from the gesture itself

    // A quick release must NOT trigger the ordinary release-to-click
    // handler (there is nothing captured for it to act on).
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("cancels when the browser tab becomes hidden and requires a fresh dwell after returning", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const clickSpy = vi.fn();
    icon.addEventListener("click", clickSpy);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.9);
    act(() => fireFrame());
    expect(result.current.dwellProgress).toBeGreaterThan(0.5);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.dwellTarget).toBeNull();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    advance(DWELL_DURATION_MS * 0.9); // would have completed under the old timer, must not have
    act(() => fireFrame());
    expect(clickSpy).not.toHaveBeenCalled();
    expect(result.current.dwellProgress).toBeLessThan(0.5); // fresh dwell, started over
  });

  it("cancels dwell on disable() and does not resume when re-enabled", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });
    act(() => fireFrame());
    expect(result.current.dwellTarget).toBe(icon);

    act(() => result.current.disable());
    expect(result.current.dwellTarget).toBeNull();
    expect(result.current.dwellProgress).toBe(0);
  });
});

describe("accelerated dwell: rate-based progress (Revision 5)", () => {
  it("advances at the normal rate while fingers are apart", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS / 2);
    act(() => fireFrame());
    expect(result.current.dwellProgress).toBeCloseTo(0.5, 2);
  });

  it("advances at ~2.5x the normal rate while isSelecting is true on the same target (DWELL_FAST_DURATION_MS)", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame()); // commits, progress 0
    mockIsSelecting = true;
    advance(DWELL_FAST_DURATION_MS / 2);
    act(() => fireFrame());
    expect(result.current.dwellProgress).toBeCloseTo(0.5, 2); // half of the FAST duration, not the normal one
  });

  it("switching rates mid-dwell preserves accumulated progress -- no reset, no jump", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame()); // commit at normal rate
    advance(DWELL_DURATION_MS * 0.2);
    act(() => fireFrame());
    const afterNormal = result.current.dwellProgress;
    expectCloseTo(afterNormal, 0.2);

    mockIsSelecting = true; // fingers come together -- switch to fast
    advance(DWELL_FAST_DURATION_MS * 0.2);
    act(() => fireFrame());
    const afterFast = result.current.dwellProgress;
    expectCloseTo(afterFast, afterNormal + 0.2); // added on top, not restarted

    mockIsSelecting = false; // fingers separate -- resume normal rate, no reset
    advance(DWELL_DURATION_MS * 0.1);
    act(() => fireFrame());
    expectCloseTo(result.current.dwellProgress, afterFast + 0.1);
  });

  it("activates exactly once when accelerated progress reaches 1, well before the normal duration would have elapsed", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const clickSpy = vi.fn();
    icon.addEventListener("click", clickSpy);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    mockIsSelecting = true;
    advance(DWELL_FAST_DURATION_MS + 10); // well under DWELL_DURATION_MS
    act(() => fireFrame());

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.dwellTarget).toBeNull();

    advance(DWELL_DURATION_MS * 2);
    act(() => fireFrame());
    expect(clickSpy).toHaveBeenCalledTimes(1); // still exactly once
  });
});

describe("isSelecting: cursor-state feedback source", () => {
  it("passes GestureProcessor.isSelecting through to state every frame, independent of phase/hoverTarget", async () => {
    stubElementsFromPoint([]); // no target under the cursor at all
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    mockIsSelecting = true;
    act(() => fireFrame());
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.phase).toBe("pointing"); // no target captured, phase never left pointing

    mockIsSelecting = false;
    act(() => fireFrame());
    expect(result.current.isSelecting).toBe(false);
  });

  it("clears isSelecting immediately on tracking loss", async () => {
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });
    mockIsSelecting = true;
    act(() => fireFrame());
    expect(result.current.isSelecting).toBe(true);

    act(() => fireStatus("error"));
    expect(result.current.isSelecting).toBe(false);
  });
});

describe("cursor shape persistence", () => {
  it("defaults to the documented shape and persists changes immediately", () => {
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.cursorShape).toBe("circle");

    act(() => result.current.setCursorShape("diamond" as CursorShape));
    expect(result.current.cursorShape).toBe("diamond");
    expect(localStorage.getItem("sant.hand.cursorShape")).toBe("diamond");
  });

  it("loads a persisted shape on the next hook instance, and resetCursorShape restores the default", () => {
    localStorage.setItem("sant.hand.cursorShape", "square");
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.cursorShape).toBe("square");

    act(() => result.current.resetCursorShape());
    expect(result.current.cursorShape).toBe("circle");
    expect(localStorage.getItem("sant.hand.cursorShape")).toBe("circle");
  });

  it("ignores a corrupted/unknown persisted value and falls back to the default", () => {
    localStorage.setItem("sant.hand.cursorShape", "hexagon");
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.cursorShape).toBe("circle");
  });
});

describe("control region persistence", () => {
  it("merges a patch, persists it, and forwards it to the live GestureProcessor", async () => {
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });
    setControlRegionSpy.mockClear(); // ignore the initial apply-on-enable call

    act(() => result.current.setControlRegion({ height: 0.4 }));

    expect(result.current.controlRegion.height).toBe(0.4);
    expect(result.current.controlRegion.width).toBe(0.55); // untouched fields preserved
    expect(setControlRegionSpy).toHaveBeenCalledWith(expect.objectContaining({ height: 0.4 }));
    expect(JSON.parse(localStorage.getItem("sant.hand.controlRegion")!).height).toBe(0.4);
  });

  it("loads a persisted region on the next hook instance", () => {
    localStorage.setItem("sant.hand.controlRegion", JSON.stringify({ centerX: 0.5, centerY: 0.6, width: 0.4, height: 0.3 }));
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.controlRegion).toEqual({ centerX: 0.5, centerY: 0.6, width: 0.4, height: 0.3 });
  });

  it("resetControlRegion restores the documented default and persists it", async () => {
    const { result } = renderHook(() => useHandPointer());
    act(() => result.current.setControlRegion({ height: 0.2 }));
    act(() => result.current.resetControlRegion());
    expect(result.current.controlRegion).toEqual({ centerX: 0.5, centerY: 0.5, width: 0.55, height: 0.55 });
  });
});

describe("interaction color", () => {
  it("defaults to the documented orange and applies it as a CSS variable immediately", () => {
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.interactionColor).toBe("#ff9a2e");
    expect(document.documentElement.style.getPropertyValue("--hand-interaction-color")).toBe("#ff9a2e");
  });

  it("setInteractionColor validates, persists, and updates the CSS variable without touching enabled/tracking state", async () => {
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => result.current.setInteractionColor("#35f0d0"));
    expect(result.current.interactionColor).toBe("#35f0d0");
    expect(document.documentElement.style.getPropertyValue("--hand-interaction-color")).toBe("#35f0d0");
    expect(localStorage.getItem("sant.hand.interactionColor")).toBe("#35f0d0");
    expect(result.current.enabled).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1); // did not restart the camera

    act(() => result.current.setInteractionColor("not-a-color"));
    expect(result.current.interactionColor).toBe("#35f0d0"); // invalid input rejected
  });

  it("does not reset or interrupt in-progress dwell when the color changes", async () => {
    const icon = makeDwellIcon();
    stubElementsFromPoint([icon]);
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    advance(DWELL_DURATION_MS * 0.5);
    act(() => fireFrame());
    const progressBefore = result.current.dwellProgress;

    act(() => result.current.setInteractionColor("#123456"));
    expect(result.current.dwellTarget).toBe(icon);
    expect(result.current.dwellProgress).toBe(progressBefore);
  });

  it("loads a persisted color on the next hook instance and resetInteractionColor restores the default", () => {
    localStorage.setItem("sant.hand.interactionColor", "#123456");
    const { result } = renderHook(() => useHandPointer());
    expect(result.current.interactionColor).toBe("#123456");

    act(() => result.current.resetInteractionColor());
    expect(result.current.interactionColor).toBe("#ff9a2e");
    expect(localStorage.getItem("sant.hand.interactionColor")).toBe("#ff9a2e");
  });
});

describe("camera cleanup", () => {
  it("calls cleanup(), not just stop(), on disable()", async () => {
    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });
    act(() => result.current.disable());
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toBe("idle");
  });

  it("cleans up on unmount even without an explicit disable()", async () => {
    const { result, unmount } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });
    unmount();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });
});

describe("one-hand behavior is unaffected on screens without a canvas", () => {
  it("ordinary click still works when no zoom gesture ever occurs", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    makeVisible(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);
    stubElementsFromPoint([button]);

    const { result } = renderHook(() => useHandPointer());
    await act(async () => {
      await result.current.enable();
    });

    act(() => fireFrame());
    act(() => fireSelect("selectstart", { x: 10, y: 10 }));
    act(() => fireSelect("selectend", { x: 10, y: 10 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("pointing");
  });
});
