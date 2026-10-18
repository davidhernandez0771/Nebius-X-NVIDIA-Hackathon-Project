// Record page: idle until asked; a blocked camera is explained; with the camera on, Start/Stop/Reset
// send the relay's control messages and the sim's sim_status is shown (plan sprint 3c, T5 Task 4).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import RecordPage from "./RecordPage";
import { renderAt, stubBackend } from "../testing";
import type { SimStatus } from "./recordLink";
import type { HandFrame, HandLandmark, TrackedHand } from "../../hand/contracts";
import { DEFAULT_TELEOP_CONTROL, TELEOP_CONTROL_STORAGE_KEY } from "../../teleop/controlRegion";
import { canonicalHand, makeHandPose, pinchThumbTip, type HandPoseOptions } from "../../teleop/__fixtures__/handPoses";

const tracker = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cleanup: vi.fn(),
  onFrame: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}));

type TeleopStatus = { socketOpen: boolean; simConnected: boolean; lastError: string | null };
const links = vi.hoisted(() => ({ list: [] as FakeLinkShape[] }));
interface FakeLinkShape {
  sent: string[];
  grips: (0 | 1 | undefined)[];
  controls: unknown[];
  closed: boolean;
  emitStatus(s: TeleopStatus): void;
  emitSim(s: SimStatus | null): void;
}

vi.mock("../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
vi.mock("./recordLink", () => ({
  RecordLink: class {
    sent: string[] = [];
    grips: (0 | 1 | undefined)[] = [];
    controls: unknown[] = [];
    closed = false;
    private statusCbs = new Set<(s: TeleopStatus) => void>();
    private simCbs = new Set<(s: SimStatus | null) => void>();
    constructor() {
      links.list.push(this as unknown as FakeLinkShape);
    }
    push(_frame: unknown, grip?: 0 | 1) {
      this.grips.push(grip);
    }
    setControl(s: unknown) {
      this.controls.push(s);
    }
    sendControl(action: string) {
      this.sent.push(action);
      return true;
    }
    onStatus(cb: (s: TeleopStatus) => void) {
      this.statusCbs.add(cb);
      return () => this.statusCbs.delete(cb);
    }
    onSimStatus(cb: (s: SimStatus | null) => void) {
      this.simCbs.add(cb);
      return () => this.simCbs.delete(cb);
    }
    close() {
      this.closed = true;
    }
    emitStatus(s: TeleopStatus) {
      this.statusCbs.forEach((cb) => cb(s));
    }
    emitSim(s: SimStatus | null) {
      this.simCbs.forEach((cb) => cb(s));
    }
  },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  links.list = [];
});

const connected: TeleopStatus = { socketOpen: true, simConnected: true, lastError: null };
const noSim: TeleopStatus = { socketOpen: true, simConnected: false, lastError: null };
const sim = (over: Partial<SimStatus> = {}): SimStatus => ({
  recording: false,
  steps: 0,
  demoId: null,
  lastResult: null,
  paused: false,
  ...over,
});

async function startCamera() {
  tracker.start.mockResolvedValueOnce(undefined);
  renderAt("/pm/record", <RecordPage />, "/pm/record");
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await screen.findByRole("button", { name: "Stop camera" });
  return links.list[0];
}

describe("Record page", () => {
  it("starts idle, without touching the camera or the relay", () => {
    const calls = stubBackend({});
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect(screen.getByRole("button", { name: "Start camera" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual([]);
    expect(tracker.start).not.toHaveBeenCalled();
    expect(links.list).toHaveLength(0);
  });

  it("explains a blocked camera and opens no relay link", async () => {
    tracker.start.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    expect(await screen.findByText(/camera is blocked/i)).toBeTruthy();
    expect(links.list).toHaveLength(0);
    expect(tracker.cleanup).toHaveBeenCalled();
  });

  it("says how to start the sim when none is connected, and keeps recording disabled", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(noSim));
    expect(screen.getByText(/sim isn't connected/i)).toBeTruthy();
    expect(screen.getByText(/teleop_sink\.py --viz kit/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset scene" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends record_start, then shows the recording and its length", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(link.sent).toEqual(["record_start"]);
    act(() => link.emitSim(sim({ recording: true, steps: 150 })));
    expect(screen.getByText("Recording")).toBeTruthy();
    expect(screen.getByTestId("recorded").textContent).toBe("3.0 s (150 steps)");
    expect((screen.getByRole("button", { name: "Reset scene" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends record_stop and links the saved demo to Review", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 376 })));
    fireEvent.click(screen.getByRole("button", { name: "Stop and save" }));
    expect(link.sent).toEqual(["record_stop"]);
    act(() =>
      link.emitSim(sim({ steps: 376, demoId: "human_20261016_ab12", lastResult: "saved human_20261016_ab12: verified success" })),
    );
    const review = screen.getByRole("link", { name: "Review human_20261016_ab12" });
    expect(review.getAttribute("href")).toBe("/pm/review?id=human_20261016_ab12");
    expect(screen.getByText("saved human_20261016_ab12: verified success")).toBeTruthy();
  });

  it("tells the person when tracking loss paused the recording", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 40, paused: true })));
    expect(screen.getByText(/paused: hand tracking lost/i)).toBeTruthy();
  });

  it("sends reset_scene while idle", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    fireEvent.click(screen.getByRole("button", { name: "Reset scene" }));
    expect(link.sent).toEqual(["reset_scene"]);
  });

  it("drops the sim's state when it disconnects", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 10 })));
    act(() => {
      link.emitStatus(noSim);
      link.emitSim(null);
    });
    expect(screen.queryByText("Recording")).toBeNull();
    expect(screen.getByText(/sim isn't connected/i)).toBeTruthy();
  });

  it("stops the camera and the link cleanly", async () => {
    const link = await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(link.closed).toBe(true);
    expect(tracker.cleanup).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeTruthy();
  });

});

// --- Hand control: the browser-side control region (teleop usability fix) -------------------

/** A hand whose palm center (mean of 0, 5, 9, 17) is at (x, y), palm `palm` wide (of the frame width). */
function handAt(x: number, y: number, pinch = 0.6, palm = 0.1): HandLandmark[] {
  const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  lm[0] = { x, y: y + 0.05, z: 0 };
  lm[9] = { x, y: y - 0.05, z: 0 };
  lm[5] = { x: x - palm / 2, y, z: 0 };
  lm[17] = { x: x + palm / 2, y, z: 0 };
  lm[4] = { x, y: y - 0.1, z: 0 };
  lm[8] = { x: x + pinch * palm, y: y - 0.1, z: 0 }; // thumb-index distance = pinch x palm width
  return lm;
}

function frameCallback(): (f: HandFrame) => void {
  const calls = tracker.onFrame.mock.calls as unknown as [(f: HandFrame) => void][];
  return calls[calls.length - 1][0];
}

function sendFrame(t: number, lm: HandLandmark[] | null) {
  const f: HandFrame = { timestamp: t, frameWidth: 640, frameHeight: 480, hands: lm ? [{ landmarks: lm, handedness: "Right" }] : [] };
  act(() => frameCallback()(f));
}

const slider = (name: RegExp) => screen.getByRole("slider", { name }) as HTMLInputElement;
const stored = () => JSON.parse(localStorage.getItem(TELEOP_CONTROL_STORAGE_KEY) ?? "null");

describe("Record page: hand control", () => {
  it("shows the default control region and gives it to the link when the camera starts", async () => {
    const link = await startCamera();
    expect(screen.getByRole("heading", { name: "Hand control" })).toBeTruthy();
    expect(Number(slider(/region size/i).value)).toBeCloseTo(0.55);
    expect((screen.getByRole("checkbox", { name: /use the control region/i }) as HTMLInputElement).checked).toBe(true);
    expect(link.controls[link.controls.length - 1]).toEqual(DEFAULT_TELEOP_CONTROL);
  });

  it("saves changes under pm.teleop.region and sends them to the link", async () => {
    const link = await startCamera();
    fireEvent.change(slider(/region size/i), { target: { value: "0.4" } });
    expect(stored().region.width).toBeCloseTo(0.4);
    expect(stored().region.height).toBeCloseTo(0.4);
    fireEvent.click(screen.getByRole("checkbox", { name: /invert up-down/i }));
    expect(stored().invertY).toBe(true);
    expect((link.controls[link.controls.length - 1] as { invertY: boolean }).invertY).toBe(true);
    expect(localStorage.getItem("sant.hand.controlRegion")).toBeNull(); // SANT's cursor region is untouched
  });

  it("loads saved settings, and Reset to defaults restores them", () => {
    localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, depthNear: 0.2 }));
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect(Number(slider(/near/i).value)).toBeCloseTo(0.2);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(Number(slider(/near/i).value)).toBeCloseTo(DEFAULT_TELEOP_CONTROL.depthNear);
    expect(stored()).toEqual(DEFAULT_TELEOP_CONTROL);
  });

  it("turning the region off sends no control (the sim's own mapping)", async () => {
    const link = await startCamera();
    fireEvent.click(screen.getByRole("checkbox", { name: /use the control region/i }));
    expect(link.controls[link.controls.length - 1]).toBeNull();
  });

  it("shows the robot height and the gripper state live", async () => {
    await startCamera();
    const r = DEFAULT_TELEOP_CONTROL.region;
    sendFrame(1000, handAt(0.5, r.centerY + r.height / 2 + 0.05)); // below the region: table height
    const meter = screen.getByRole("meter", { name: /robot height/i });
    expect(Number(meter.getAttribute("aria-valuenow"))).toBe(0);
    expect(screen.getByText(/at the table/i)).toBeTruthy();
    expect(screen.getByText("Gripper open")).toBeTruthy();
    sendFrame(1200, handAt(0.5, r.centerY - r.height / 2, 0.2)); // top of the region, pinching
    sendFrame(1300, handAt(0.5, r.centerY - r.height / 2, 0.2)); // the gripper changes on 2 frames in a row
    expect(Number(screen.getByRole("meter", { name: /robot height/i }).getAttribute("aria-valuenow"))).toBe(100);
    expect(screen.getByText("Gripper closed")).toBeTruthy();
  });

  it("calibrates by hand: comfortable movement, then near and far holds", async () => {
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect((screen.getByRole("button", { name: /calibrate by hand/i }) as HTMLButtonElement).disabled).toBe(true);
    tracker.start.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByRole("button", { name: "Stop camera" });

    fireEvent.click(screen.getByRole("button", { name: /calibrate by hand/i }));
    expect(screen.getByText(/move your hand slowly/i)).toBeTruthy();
    let t = 0;
    // Sweep x 0.4..0.6 and y 0.3..0.6 within the 5 s move step, then hold at the far corner.
    for (; t <= 5100; t += 50) sendFrame(t, handAt(0.4 + 0.2 * Math.min(1, t / 4000), 0.3 + 0.3 * Math.min(1, t / 4000)));
    expect(screen.getByText(/close to the camera/i)).toBeTruthy();
    const near = handAt(0.5, 0.45).map((p, i) => ([5, 17].includes(i) ? { ...p, x: 0.5 + (p.x - 0.5) * 1.6 } : p));
    for (const end = t + 3100; t <= end; t += 50) sendFrame(t, near);
    expect(screen.getByText(/back, away from the camera/i)).toBeTruthy();
    const far = handAt(0.5, 0.45).map((p, i) => ([5, 17].includes(i) ? { ...p, x: 0.5 + (p.x - 0.5) * 0.7 } : p));
    for (const end = t + 3100; t <= end; t += 50) sendFrame(t, far);

    expect(screen.getByText(/^calibrated: region/i)).toBeTruthy();
    const s = stored();
    expect(s.region.centerY).toBeCloseTo(0.45, 1);
    expect(s.region.width).toBeCloseTo(0.3 * 1.05, 2);
    expect(s.depthFar).toBeLessThan(s.depthNear);
    expect(s.depthAuto).toBe(false); // the calibrated range overrides auto-centering until reset
  });
});

// --- Reach (live test #2): forward/back was stuck at x 0.30 and invisible -------------------

/** Frames every 33 ms from t0 for ms, with the hand at the frame center and the given palm width. */
function holdHand(t0: number, ms: number, palm: number): number {
  let t = t0;
  for (; t <= t0 + ms; t += 33) sendFrame(t, handAt(0.5, 0.45, 0.6, palm));
  return t;
}

const meter = (name: RegExp) => screen.getByRole("meter", { name });

describe("Record page: reach", () => {
  it("auto-centers reach on the natural palm width when tracking starts: depth 0.5 = the cube's row", async () => {
    const link = await startCamera();
    // The user's live palm width, below the old 0.07 far default (which clamped depth to 0).
    let t = holdHand(500, 1100, 0.059);
    expect(stored().depthFar).toBeCloseTo(0.059 / 1.3, 3);
    expect(stored().depthNear).toBeCloseTo(0.059 * 1.3, 3);
    expect(stored().depthAuto).toBe(true);
    expect((link.controls[link.controls.length - 1] as { depthFar: number }).depthFar).toBeCloseTo(0.059 / 1.3, 3);
    t = holdHand(t, 600, 0.059); // let the smoothed depth settle
    expect(Number(meter(/reach/i).getAttribute("aria-valuenow"))).toBe(50);
    expect(meter(/reach/i).getAttribute("aria-valuetext")).toMatch(/x = 50 cm.*cube's row/i);
    holdHand(t, 600, 0.059 * 1.3); // 30% closer: fully forward
    expect(Number(meter(/reach/i).getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(97);
    expect(meter(/reach/i).getAttribute("aria-valuetext")).toMatch(/x = 70 cm/i);
  });

  it("a calibrated (or hand-set) depth range is not auto-centered until Reset to defaults", async () => {
    localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, depthFar: 0.05, depthNear: 0.09, depthAuto: false }));
    await startCamera();
    holdHand(500, 1500, 0.1);
    expect(stored().depthFar).toBeCloseTo(0.05, 6);
    fireEvent.change(slider(/near/i), { target: { value: "0.1" } });
    expect(stored().depthAuto).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(stored().depthAuto).toBe(true);
  });

  it("moving a depth slider by hand turns auto-centering off", async () => {
    await startCamera();
    fireEvent.change(slider(/far/i), { target: { value: "0.05" } });
    expect(stored().depthAuto).toBe(false);
  });

  it("Re-center reach re-centers on the current palm width, even over a calibration", async () => {
    localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, depthFar: 0.05, depthNear: 0.09, depthAuto: false }));
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect((screen.getByRole("button", { name: /re-center reach/i }) as HTMLButtonElement).disabled).toBe(true);
    tracker.start.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByRole("button", { name: "Stop camera" });
    holdHand(0, 1500, 0.1); // calibrated: nothing changes
    expect(stored().depthFar).toBeCloseTo(0.05, 6);
    fireEvent.click(screen.getByRole("button", { name: /re-center reach/i }));
    expect(screen.getByText(/hold your hand where it feels natural/i)).toBeTruthy();
    holdHand(2000, 1100, 0.08);
    expect(stored().depthFar).toBeCloseTo(0.08 / 1.3, 3);
    expect(stored().depthNear).toBeCloseTo(0.08 * 1.3, 3);
    expect(screen.queryByText(/hold your hand where it feels natural/i)).toBeNull();
  });

  it("explains the three axes, one line each", () => {
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect(screen.getByText(/left-right.*side/i)).toBeTruthy();
    expect(screen.getByText(/up-down.*height/i)).toBeTruthy();
    expect(screen.getByText(/closer.*farther.*reach/i)).toBeTruthy();
  });

  it("shows the live [u, v, depth] numbers, so a clamped axis is visible", async () => {
    await startCamera();
    expect(screen.getByTestId("control-now").textContent).toBe("–");
    const r = DEFAULT_TELEOP_CONTROL.region;
    sendFrame(100, handAt(0.5, r.centerY + r.height / 2 + 0.1)); // below the box: v clamped to 1
    expect(screen.getByTestId("control-now").textContent).toMatch(/^u 0\.50 · v 1\.00 · depth 0\.\d\d$/);
  });
});

// --- Hand v3: 3D pinch from HandLandmarker's world landmarks, no freezing ------------------------

/** A HandLandmarker hand with world landmarks (meters). */
function hand3d(opts: HandPoseOptions = {}): TrackedHand {
  const { world, landmarks } = makeHandPose(opts);
  return { landmarks, worldLandmarks: world, handedness: "Right" };
}

/** An open hand whose thumb tip sits so the 3D pinch reads `v` index-finger lengths. */
function pinchAt(v: number, opts: HandPoseOptions = {}): TrackedHand {
  const c = canonicalHand();
  const d = (a: number, b: number) => Math.hypot(c[a].x - c[b].x, c[a].y - c[b].y, c[a].z - c[b].z);
  const len = d(5, 6) + d(6, 7) + d(7, 8);
  return hand3d({ ...opts, thumbTip: { ...c[8], x: c[8].x - v * len } });
}

function sendHand(t: number, h: TrackedHand | null) {
  const f: HandFrame = { timestamp: t, frameWidth: 640, frameHeight: 480, hands: h ? [h] : [] };
  act(() => frameCallback()(f));
}

function holdFor(t0: number, ms: number, h: TrackedHand) {
  for (let t = t0; t <= t0 + ms; t += 33) sendHand(t, h);
  return t0 + ms + 33;
}

const lastGrip = (link: FakeLinkShape) => link.grips[link.grips.length - 1];
const rad = (d: number) => (d * Math.PI) / 180;

describe("Record page: 3D pinch (hand v3)", () => {
  it("closes on 2 pinched frames in a row and sends the grip with the hand pose", async () => {
    const link = await startCamera();
    sendHand(0, hand3d());
    expect(lastGrip(link)).toBe(0);
    sendHand(33, hand3d({ thumbTip: pinchThumbTip() }));
    expect(lastGrip(link)).toBe(0);
    sendHand(66, hand3d({ thumbTip: pinchThumbTip() }));
    expect(lastGrip(link)).toBe(1);
    holdFor(100, 200, hand3d({ thumbTip: pinchThumbTip() }));
    expect(screen.getByText("Gripper closed")).toBeTruthy();
    holdFor(400, 200, hand3d());
    expect(lastGrip(link)).toBe(0);
  });

  it("never freezes: a pinch closes with the palm sideways or the back of the hand to the camera", async () => {
    for (const deg of [80, 170]) {
      const link = await startCamera();
      holdFor(0, 100, hand3d({ rot: { y: rad(deg) } }));
      holdFor(200, 100, hand3d({ rot: { y: rad(deg) }, thumbTip: pinchThumbTip() }));
      expect([deg, lastGrip(link)]).toEqual([deg, 1]);
      cleanup();
      links.list = [];
    }
  });

  it("the arm keeps following the hand whatever its rotation", async () => {
    await startCamera();
    holdFor(0, 200, hand3d({ rot: { y: rad(170) }, center: { x: 0.4, y: 0.45 } }));
    const before = screen.getByTestId("control-now").textContent;
    holdFor(300, 200, hand3d({ rot: { y: rad(170) }, center: { x: 0.6, y: 0.45 } }));
    expect(screen.getByTestId("control-now").textContent).not.toBe(before);
  });

  it("without world landmarks, falls back to the 2D pinch", async () => {
    const link = await startCamera();
    sendFrame(0, handAt(0.5, 0.5, 0.2));
    sendFrame(33, handAt(0.5, 0.5, 0.2));
    expect(lastGrip(link)).toBe(1);
    expect(screen.getByTestId("pinch-now").textContent).toMatch(/2D/);
  });

  it("shows the live pinch value against both thresholds", async () => {
    await startCamera();
    holdFor(0, 200, pinchAt(0.6));
    const m = screen.getByRole("meter", { name: "Pinch" });
    expect(Number(m.getAttribute("aria-valuenow"))).toBeCloseTo(0.6, 1);
    expect(m.getAttribute("aria-valuetext")).toMatch(/closes below 0\.48, opens above 0\.72/);
    expect(screen.getByTestId("pinch-now").textContent).toMatch(/0\.60 \(3D\)/);
  });
});

describe("Record page: Calibrate pinch", () => {
  it("hold open, then pinch: the thresholds are saved and a loose pinch then closes the gripper", async () => {
    const link = await startCamera();
    const loose = pinchAt(0.6); // between the default thresholds (0.48 / 0.72): no grip by default
    let t = holdFor(0, 300, loose);
    expect(lastGrip(link)).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Calibrate pinch" }));
    t = holdFor(t, 100, hand3d());
    expect(screen.getByText(/hold your hand open/i)).toBeTruthy();
    t = holdFor(t, 2100, hand3d());
    expect(screen.getByText(/now pinch/i)).toBeTruthy();
    t = holdFor(t, 2200, loose);
    expect(screen.getByText(/pinch calibrated/i)).toBeTruthy();
    const cal = stored().indexPinchCal;
    expect(cal.pinched).toBeCloseTo(0.6, 2);
    expect(cal.open).toBeGreaterThan(1);

    t = holdFor(t, 300, hand3d());
    expect(lastGrip(link)).toBe(0);
    holdFor(t, 300, loose);
    expect(lastGrip(link)).toBe(1);
  });

  it("can be cancelled", async () => {
    await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Calibrate pinch" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel pinch calibration" }));
    expect(screen.getByRole("button", { name: "Calibrate pinch" })).toBeTruthy();
    expect(stored()?.indexPinchCal ?? null).toBeNull();
  });
});
