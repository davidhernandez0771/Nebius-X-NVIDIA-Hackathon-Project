// Record page: idle until asked; a blocked camera is explained; with the camera on, Start/Stop/Reset
// send the relay's control messages and the sim's sim_status is shown (plan sprint 3c, T5 Task 4).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import RecordPage from "./RecordPage";
import { renderAt, stubBackend } from "../testing";
import type { SimStatus } from "../../../pm/record/recordLink";
import type { HandFrame, HandLandmark } from "../../../hand/contracts";
import { DEFAULT_TELEOP_CONTROL, TELEOP_CONTROL_STORAGE_KEY } from "../../../teleop/controlRegion";

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
  controls: unknown[];
  closed: boolean;
  emitStatus(s: TeleopStatus): void;
  emitSim(s: SimStatus | null): void;
}

vi.mock("../../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
vi.mock("../../../pm/record/recordLink", () => ({
  RecordLink: class {
    sent: string[] = [];
    controls: unknown[] = [];
    closed = false;
    private statusCbs = new Set<(s: TeleopStatus) => void>();
    private simCbs = new Set<(s: SimStatus | null) => void>();
    constructor() {
      links.list.push(this as unknown as FakeLinkShape);
    }
    push() {}
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

/** A hand whose palm center (mean of 0, 5, 9, 17) is at (x, y), palm 0.1 wide on a 640 px frame. */
function handAt(x: number, y: number, pinch = 0.6): HandLandmark[] {
  const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  lm[0] = { x, y: y + 0.05, z: 0 };
  lm[9] = { x, y: y - 0.05, z: 0 };
  lm[5] = { x: x - 0.05, y, z: 0 };
  lm[17] = { x: x + 0.05, y, z: 0 };
  lm[4] = { x, y: y - 0.1, z: 0 };
  lm[8] = { x: x + pinch * 0.1, y: y - 0.1, z: 0 }; // thumb-index distance = pinch x palm width
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

    expect(screen.getByText(/calibrated/i)).toBeTruthy();
    const s = stored();
    expect(s.region.centerY).toBeCloseTo(0.45, 1);
    expect(s.region.width).toBeCloseTo(0.3 * 1.05, 2);
    expect(s.depthFar).toBeLessThan(s.depthNear);
  });
});
