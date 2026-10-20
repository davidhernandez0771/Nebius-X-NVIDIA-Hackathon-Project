// Record page: idle until asked; a blocked camera is explained; with the camera on, Start/Stop/Reset
// send the relay's control messages and the sim's sim_status is shown (plan sprint 3c, T5 Task 4).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import RecordPage from "./RecordPage";
import { renderAt, stubBackend } from "../testing";
import type { SimStatus } from "../../../record/recordLink";
import type { HandFrame, HandLandmark, TrackedHand } from "../../../hand/contracts";
import { DEFAULT_TELEOP_CONTROL, TELEOP_CONTROL_STORAGE_KEY } from "../../../record/teleop/controlRegion";
import { stableSize } from "../../../record/teleop/depthSignal";
import { FIST_FLEX, VICTORY_FLEX, VICTORY_THUMB, canonicalHand, makeHandPose, pinchThumbTip, type HandPoseOptions } from "../../../record/teleop/__fixtures__/handPoses";

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
  inputs: string[];
  msgs: unknown[];
  closed: boolean;
  emitStatus(s: TeleopStatus): void;
  emitSim(s: SimStatus | null): void;
}

vi.mock("../../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
// Every frame's hand is used, as before the hand lock: these tests jump one hand between poses, which
// the lock would hold as glitches. The lock is tested in record/teleop/handLock.test.ts and
// record/useRecordSession.handLock.test.ts.
vi.mock("../../../record/teleop/handLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../record/teleop/handLock")>()),
  HandLock: (await import("../../../record/teleop/__fixtures__/passThroughLock")).PassThroughHandLock,
}));
// The hand-art overlay is WebGL (three.js); here only its mounting and props matter.
const art = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../../../record/handArt", () => ({
  LazyHandArtOverlay: (props: Record<string, unknown>) => {
    art.props = props;
    return <div data-testid="hand-art-overlay" />;
  },
}));
vi.mock("../../../record/recordLink", () => ({
  RecordLink: class {
    sent: string[] = [];
    grips: (0 | 1 | undefined)[] = [];
    controls: unknown[] = [];
    inputs: string[] = [];
    msgs: unknown[] = [];
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
    assists: boolean[] = [];
    sendAssist(on: boolean) {
      this.assists.push(on);
      return true;
    }
    sendControl(action: string, input?: string) {
      if (action === "set_input") this.inputs.push(input ?? "");
      else this.sent.push(action);
      return true;
    }
    send(msg: unknown, grip?: 0 | 1) {
      this.msgs.push(msg);
      this.grips.push(grip);
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
  renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await screen.findByRole("button", { name: "Stop camera" });
  return links.list[0];
}

describe("Record page", () => {
  it("starts idle, without touching the camera or the relay", () => {
    const calls = stubBackend({});
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
    expect(screen.getByRole("button", { name: "Start camera" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual([]);
    expect(tracker.start).not.toHaveBeenCalled();
    expect(links.list).toHaveLength(0);
  });

  it("explains a blocked camera and opens no relay link", async () => {
    tracker.start.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
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
    expect(review.getAttribute("href")).toBe("/legacy/pm/review?id=human_20261016_ab12");
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
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
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
    sendFrame(1200, handAt(0.5, r.centerY - r.height / 2, 0.1)); // top of the region, pinching
    expect(Number(screen.getByRole("meter", { name: /robot height/i }).getAttribute("aria-valuenow"))).toBe(100);
    expect(screen.getByText("Gripper closed")).toBeTruthy();
  });

  it("calibrates by hand: comfortable movement, then near and far holds", async () => {
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
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
/** handAt for a hand at another distance: every point scaled about the centre (a hand 30% closer is 30% bigger
 *  everywhere, not only across the knuckles), so the reach signal (depthSignal.stableSize) scales with palm too. */
function handAtDistance(palm: number): HandLandmark[] {
  const k = palm / 0.1;
  return handAt(0.5, 0.45, 0.6, 0.1).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.45 + (p.y - 0.45) * k }));
}
/** The reach signal the page uses for that hand (pinch-stable, in palm-width units). */
const reachOf = (palm: number) => stableSize(handAtDistance(palm), 640, 480)!;

function holdHand(t0: number, ms: number, palm: number): number {
  let t = t0;
  for (; t <= t0 + ms; t += 33) sendFrame(t, handAtDistance(palm));
  return t;
}

const meter = (name: RegExp) => screen.getByRole("meter", { name });

describe("Record page: reach", () => {
  it("auto-centers reach on the natural palm width when tracking starts: depth 0.5 = the cube's row", async () => {
    const link = await startCamera();
    // The user's live palm width, below the old 0.07 far default (which clamped depth to 0).
    let t = holdHand(500, 1100, 0.059);
    expect(stored().depthFar).toBeCloseTo(reachOf(0.059) / 1.3, 3);
    expect(stored().depthNear).toBeCloseTo(reachOf(0.059) * 1.3, 3);
    expect(stored().depthAuto).toBe(true);
    expect((link.controls[link.controls.length - 1] as { depthFar: number }).depthFar).toBeCloseTo(reachOf(0.059) / 1.3, 3);
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
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
    expect((screen.getByRole("button", { name: /re-center reach/i }) as HTMLButtonElement).disabled).toBe(true);
    tracker.start.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByRole("button", { name: "Stop camera" });
    holdHand(0, 1500, 0.1); // calibrated: nothing changes
    expect(stored().depthFar).toBeCloseTo(0.05, 6);
    fireEvent.click(screen.getByRole("button", { name: /re-center reach/i }));
    expect(screen.getByText(/hold your hand where it feels natural/i)).toBeTruthy();
    holdHand(2000, 1100, 0.08);
    expect(stored().depthFar).toBeCloseTo(reachOf(0.08) / 1.3, 3);
    expect(stored().depthNear).toBeCloseTo(reachOf(0.08) * 1.3, 3);
    expect(screen.queryByText(/hold your hand where it feels natural/i)).toBeNull();
  });

  it("explains the three axes, one line each", () => {
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
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

// --- Hand v4: the simple 2D pinch, no freezing ----------------------------------------------------

/** A HandLandmarker hand with world landmarks (meters). */
function hand3d(opts: HandPoseOptions = {}): TrackedHand {
  const { world, landmarks } = makeHandPose(opts);
  return { landmarks, worldLandmarks: world, handedness: "Right" };
}

/** A hand whose thumb tip is `cm` centimeters from its index tip. */
function tipsApart(cm: number, opts: HandPoseOptions = {}): TrackedHand {
  const c = canonicalHand();
  return hand3d({ ...opts, thumbTip: { ...c[8], x: c[8].x - cm / 100 } });
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

describe("Record page: pinch (thumb tip and index tip together = closed)", () => {
  it("closes on the first pinched frame and sends the grip with the hand pose", async () => {
    const link = await startCamera();
    sendHand(0, hand3d());
    expect(lastGrip(link)).toBe(0);
    sendHand(33, hand3d({ thumbTip: pinchThumbTip() }));
    expect(lastGrip(link)).toBe(1);
    holdFor(66, 200, hand3d({ thumbTip: pinchThumbTip() }));
    expect(screen.getByText("Gripper closed")).toBeTruthy();
  });

  it("while holding, one open frame never opens it; open for ~150 ms does", async () => {
    const link = await startCamera();
    let t = holdFor(0, 200, hand3d({ thumbTip: pinchThumbTip() }));
    sendHand(t, hand3d()); // one noisy frame reads wide open
    expect(lastGrip(link)).toBe(1);
    t = holdFor(t + 33, 200, hand3d({ thumbTip: pinchThumbTip() }));
    sendHand(t, hand3d());
    sendHand(t + 100, hand3d());
    expect(lastGrip(link)).toBe(1);
    sendHand(t + 150, hand3d());
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

  it("needs no world landmarks", async () => {
    const link = await startCamera();
    sendFrame(0, handAt(0.5, 0.5, 0.1));
    expect(lastGrip(link)).toBe(1);
  });

  it("shows the live pinch value against both thresholds", async () => {
    await startCamera();
    holdFor(0, 200, tipsApart(3));
    const m = screen.getByRole("meter", { name: "Pinch" });
    const v = Number(m.getAttribute("aria-valuenow"));
    expect(v).toBeGreaterThan(0.25);
    expect(v).toBeLessThan(0.5);
    expect(m.getAttribute("aria-valuetext")).toMatch(/closes below 0\.25, opens above 0\.50 for 150 ms/);
    expect(screen.getByTestId("pinch-now").textContent).toBe(v.toFixed(2));
  });

  it("has no Calibrate pinch: the thresholds are fixed", async () => {
    await startCamera();
    expect(screen.queryByRole("button", { name: /calibrate pinch/i })).toBeNull();
  });
});

describe("Record page: hand art (display only)", () => {
  type ArtFrame = { landmarks: unknown; gripperClosed?: boolean; cue?: number } | null;
  const artFrame = () => (art.props!.source as () => ArtFrame)();

  it("is on by default, and its toggle turns it off", async () => {
    await startCamera();
    expect(screen.getByTestId("hand-art-overlay")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /hand art/i }));
    expect(stored().showHandArt).toBe(false);
    expect(screen.queryByTestId("hand-art-overlay")).toBeNull();
  });

  it("changes style on grab, release and Reset scene, not on a timer", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    expect(art.props).toMatchObject({ trigger: "events" });
    let t = holdFor(0, 200, hand3d());
    const c0 = artFrame()!.cue!;
    t = holdFor(t, 200, hand3d({ thumbTip: pinchThumbTip() }));
    expect(artFrame()!.gripperClosed).toBe(true);
    expect(artFrame()!.cue).toBe(c0 + 1);
    t = holdFor(t, 200, hand3d());
    expect(artFrame()!.cue).toBe(c0 + 2);
    t = holdFor(t, 3000, hand3d()); // seconds of nothing happening: no change
    expect(artFrame()!.cue).toBe(c0 + 2);
    fireEvent.click(screen.getByRole("button", { name: "Reset scene" }));
    sendHand(t, hand3d());
    expect(artFrame()!.cue).toBe(c0 + 3);
  });

  it("changes style when recording starts and stops", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    sendHand(0, hand3d());
    const c0 = artFrame()!.cue!;
    act(() => link.emitSim(sim({ recording: true })));
    sendHand(33, hand3d());
    expect(artFrame()!.cue).toBe(c0 + 1);
    act(() => link.emitSim(sim({ recording: false })));
    sendHand(66, hand3d());
    expect(artFrame()!.cue).toBe(c0 + 2);
  });

  it("is the original morph: the overlay gets the hand, the gripper and the event counter only", async () => {
    await startCamera();
    sendHand(0, hand3d());
    expect(Object.keys(artFrame()!).sort()).toEqual(["cue", "gripperClosed", "landmarks"]);
  });

  it("does not change what is sent: same grips and control with it on or off", async () => {
    const session = async (showHandArt: boolean) => {
      localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, showHandArt }));
      const link = await startCamera();
      const controls: (string | null)[] = [];
      for (let i = 0; i < 30; i++) {
        const pinched = i % 10 > 5;
        sendHand(i * 100, hand3d({ center: { x: 0.4 + i * 0.005, y: 0.45 }, ...(pinched ? { thumbTip: pinchThumbTip() } : {}) }));
        controls.push(screen.getByTestId("control-now").textContent);
      }
      const out = { grips: [...link.grips], controls };
      cleanup();
      links.list = [];
      localStorage.clear();
      return out;
    };
    const on = await session(true);
    const off = await session(false);
    expect(on.grips).toContain(1);
    expect(on).toEqual(off);
  });
});

// --- Reset gesture: the V sign from HandLandmarker landmarks, held 1.5 s ------------------------

const victoryHand = () => hand3d({ fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB });

describe("Record page: reset gesture", () => {
  it("holding the V sign for 1.5 s sends reset_scene once, and the ring fills", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    holdFor(0, 800, victoryHand());
    const ring = screen.getByRole("progressbar", { name: /reset/i });
    expect(Number(ring.getAttribute("aria-valuenow"))).toBeGreaterThan(30);
    expect(link.sent).not.toContain("reset_scene");
    holdFor(833, 1500, victoryHand());
    expect(link.sent.filter((a) => a === "reset_scene")).toHaveLength(1);
  });

  it("does not reset while recording, or with the sim not connected", async () => {
    const link = await startCamera();
    holdFor(0, 1700, victoryHand()); // no sim
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true })));
    holdFor(2000, 1700, hand3d());
    holdFor(4000, 1700, victoryHand());
    expect(link.sent).not.toContain("reset_scene");
  });

  it("an open hand, a fist or a pinch never resets", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    let t = holdFor(0, 1700, hand3d());
    t = holdFor(t, 1700, hand3d({ flex: FIST_FLEX }));
    holdFor(t, 1700, hand3d({ thumbTip: pinchThumbTip() }));
    expect(link.sent).not.toContain("reset_scene");
  });

  it("shows a 'Reset fired' toast every time it fires, and says when the reset was not sent", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    let t = holdFor(0, 400, hand3d());
    expect(screen.queryByText(/reset fired/i)).toBeNull();
    t = holdFor(t, 1600, victoryHand());
    expect(screen.getByRole("status", { name: /reset fired/i }).textContent).toMatch(/^Reset fired$/);
    t = holdFor(t, 3000, hand3d()); // the toast goes after a few seconds; the hand drops the sign
    expect(screen.queryByText(/reset fired/i)).toBeNull();
    t = holdFor(t, 1600, victoryHand());
    expect(link.sent.filter((a) => a === "reset_scene")).toHaveLength(2);
    expect(screen.getByRole("status", { name: /reset fired/i })).toBeTruthy();
    t = holdFor(t, 3000, hand3d());
    act(() => link.emitSim(sim({ recording: true })));
    holdFor(t, 1600, victoryHand());
    expect(link.sent.filter((a) => a === "reset_scene")).toHaveLength(2);
    expect(screen.getByRole("status", { name: /reset fired/i }).textContent).toMatch(/not sent: stop recording first/i);
  });

  it("shows the V sign score live", async () => {
    await startCamera();
    holdFor(0, 200, victoryHand());
    expect(Number(screen.getByTestId("victory-now").textContent)).toBeGreaterThan(0.9);
  });
});

// --- Optional 3D reach (off by default), both reach signals shown live -----------------------

describe("Record page: 3D reach", () => {
  it("is off by default; both the palm width and the 3D size are shown live", async () => {
    await startCamera();
    expect((screen.getByRole("checkbox", { name: /3d reach/i }) as HTMLInputElement).checked).toBe(false);
    holdFor(0, 200, hand3d({ rot: { y: rad(60) } }));
    const pw = Number(screen.getByTestId("reach-2d").textContent);
    const s3 = Number(screen.getByTestId("reach-3d").textContent);
    expect(pw).toBeGreaterThan(0);
    expect(s3).toBeGreaterThan(pw * 1.5); // turned 60 degrees: the pixel palm width shrinks, the 3D size doesn't
  });

  it("turned on: reach re-centers on the 3D size, and turning the hand barely moves it", async () => {
    await startCamera();
    let t = holdFor(0, 1200, hand3d()); // the palm-width auto-centering finishes
    fireEvent.click(screen.getByRole("checkbox", { name: /3d reach/i }));
    expect(stored().reach3d).toBe(true);
    expect(screen.getByText(/hold your hand where it feels natural/i)).toBeTruthy(); // re-centering on the new signal
    t = holdFor(t, 1200, hand3d());
    const facing = Number(screen.getByRole("meter", { name: /reach/i }).getAttribute("aria-valuenow"));
    expect(facing).toBeGreaterThan(40);
    expect(facing).toBeLessThan(60);
    holdFor(t, 600, hand3d({ rot: { y: rad(60) } }));
    const turned = Number(screen.getByRole("meter", { name: /reach/i }).getAttribute("aria-valuenow"));
    expect(Math.abs(turned - facing)).toBeLessThan(10);
  });
});

// --- Break-through: reach crossing the cube's row in depth switches the hand-art style ------------

describe("Record page: break-through switches the hand-art style", () => {
  type ArtFrame = { cue?: number } | null;
  const cue = () => (art.props!.source as () => ArtFrame)()!.cue!;
  const at = (distance: number, x = 0.5) => hand3d({ distance, center: { x, y: 0.45 } });

  it("crossing the cube's row in depth, either way, is one style switch each", async () => {
    await startCamera();
    let t = holdFor(0, 1500, at(0.5)); // auto-centering: this distance becomes depth 0.5
    t = holdFor(t, 600, at(0.62)); // back: depth below the band
    const c0 = cue();
    t = holdFor(t, 600, at(0.4)); // through the cube's row, toward the camera
    expect(cue()).toBe(c0 + 1);
    holdFor(t, 600, at(0.62)); // back out
    expect(cue()).toBe(c0 + 2);
  });

  it("nothing at the reach limits or the box's edges", async () => {
    await startCamera();
    let t = holdFor(0, 1500, at(0.5));
    t = holdFor(t, 600, at(0.4));
    const c0 = cue();
    t = holdFor(t, 600, at(0.25)); // all the way forward: depth clamps at 1
    t = holdFor(t, 600, at(0.4, 0.95)); // the palm leaves the square sideways
    t = holdFor(t, 600, at(0.4, 0.05));
    holdFor(t, 600, at(0.4, 0.5));
    expect(cue()).toBe(c0);
  });
});

describe("Record page: debug trace", () => {
  it("records 10 s of frames with both reach signals, then offers the JSON file to download", async () => {
    const blobs: Blob[] = [];
    const urls = Object.getOwnPropertyDescriptors(URL);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((b: Blob) => (blobs.push(b), `blob:trace-${blobs.length}`)),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    try {
      await startCamera();
      fireEvent.click(screen.getByRole("button", { name: /record debug trace/i }));
      sendHand(0, hand3d({ rot: { y: rad(50) } }));
      expect(screen.getByText(/recording a debug trace/i)).toBeTruthy();
      for (let t = 100; t <= 10_100; t += 100) sendHand(t, hand3d({ rot: { y: rad(50) } }));
      const link = screen.getByRole("link", { name: /download debug trace/i });
      expect(link.getAttribute("download")).toMatch(/^pm-hand-trace-[\d-]+\.json$/);
      const file = JSON.parse(await blobs[0].text());
      expect(file.kind).toBe("pm-hand-trace");
      expect(file.frames.length).toBeGreaterThanOrEqual(100);
      const f = file.frames[5];
      expect(f.world).toHaveLength(21);
      expect(f.reach.palmWidth).toBeGreaterThan(0);
      expect(f.reach.size3d).toBeGreaterThan(f.reach.palmWidth); // turned: both are there to compare
      expect(f.reach.stable).toBeGreaterThan(0);
      expect(f.reach.used).toBe(f.reach.stable); // 3D reach off by default: the pinch-stable size (no pinch: not rescaled)
      expect(f.pinch).toBeGreaterThan(0.5); // the 2D pinch gap, hand open
      expect(f.breakthrough).toMatchObject({ count: 0 });
      expect(f.sent.control).toHaveLength(3);
      fireEvent.click(screen.getByRole("button", { name: /record debug trace/i }));
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:trace-1");
    } finally {
      if (urls.createObjectURL) Object.defineProperty(URL, "createObjectURL", urls.createObjectURL);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
      if (urls.revokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", urls.revokeObjectURL);
      else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("can't start without the camera", () => {
    renderAt("/legacy/pm/record", <RecordPage />, "/legacy/pm/record");
    expect((screen.getByRole("button", { name: /record debug trace/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
