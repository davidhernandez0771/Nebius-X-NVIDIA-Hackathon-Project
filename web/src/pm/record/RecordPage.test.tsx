// Record page: idle until asked, and a blocked camera is explained, not blank.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import RecordPage from "./RecordPage";
import { renderAt, stubBackend } from "../testing";

const tracker = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cleanup: vi.fn(),
  onFrame: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}));
const sockets = vi.hoisted(() => ({ opened: 0 }));

vi.mock("../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
vi.mock("../../teleop/teleopClient", () => ({
  TeleopClient: class {
    constructor() {
      sockets.opened += 1;
    }
    push() {}
    onStatus() {
      return () => {};
    }
    close() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sockets.opened = 0;
});

describe("Record page", () => {
  it("starts idle, without touching the camera or the relay", () => {
    const calls = stubBackend({});
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    expect(screen.getByRole("button", { name: "Start streaming" })).toBeTruthy();
    expect(calls).toEqual([]);
    expect(tracker.start).not.toHaveBeenCalled();
    expect(sockets.opened).toBe(0);
  });

  it("explains a blocked camera and opens no relay socket", async () => {
    tracker.start.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    fireEvent.click(screen.getByRole("button", { name: "Start streaming" }));
    expect(await screen.findByText(/camera is blocked/i)).toBeTruthy();
    expect(sockets.opened).toBe(0);
    expect(tracker.cleanup).toHaveBeenCalled();
  });

  it("streams once the camera starts, and stops cleanly", async () => {
    tracker.start.mockResolvedValueOnce(undefined);
    renderAt("/pm/record", <RecordPage />, "/pm/record");
    fireEvent.click(screen.getByRole("button", { name: "Start streaming" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(sockets.opened).toBe(1);
    expect(tracker.cleanup).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start streaming" })).toBeTruthy();
  });
});
