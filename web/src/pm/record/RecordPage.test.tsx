// Record page: idle until asked; a blocked camera is explained; with the camera on, Start/Stop/Reset
// send the relay's control messages and the sim's sim_status is shown (plan sprint 3c, T5 Task 4).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import RecordPage from "./RecordPage";
import { renderAt, stubBackend } from "../testing";
import type { SimStatus } from "./recordLink";

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
  closed: boolean;
  emitStatus(s: TeleopStatus): void;
  emitSim(s: SimStatus | null): void;
}

vi.mock("../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
vi.mock("./recordLink", () => ({
  RecordLink: class {
    sent: string[] = [];
    closed = false;
    private statusCbs = new Set<(s: TeleopStatus) => void>();
    private simCbs = new Set<(s: SimStatus | null) => void>();
    constructor() {
      links.list.push(this as unknown as FakeLinkShape);
    }
    push() {}
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
