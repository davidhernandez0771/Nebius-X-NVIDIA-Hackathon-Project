// /record: the Volt Record page on the shared teleop session. The session itself is covered by
// legacy/pm/record/RecordPage.test.tsx (same hook); here: the rack shows what the session sends, the
// record button and its timer, the sim notice, and the settings drawer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import type { HandFrame, TrackedHand } from "../../hand/contracts";
import type { SimStatus } from "../../record/recordLink";
import { DEFAULT_TELEOP_CONTROL, TELEOP_CONTROL_STORAGE_KEY } from "../../record/teleop/controlRegion";
import { VICTORY_FLEX, VICTORY_THUMB, makeHandPose, pinchThumbTip, type HandPoseOptions } from "../../record/teleop/__fixtures__/handPoses";
import { RecordConsole } from "./RecordConsole";

const tracker = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cleanup: vi.fn(),
  onFrame: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}));

type TeleopStatus = { socketOpen: boolean; simConnected: boolean; lastError: string | null };
interface FakeLink {
  sent: string[];
  grips: (0 | 1 | undefined)[];
  controls: unknown[];
  closed: boolean;
  emitStatus(s: TeleopStatus): void;
  emitSim(s: SimStatus | null): void;
}
const links = vi.hoisted(() => ({ list: [] as FakeLink[] }));

vi.mock("../../hand/tracking", () => ({ createMediapipeTracker: () => tracker }));
// Every frame's hand is used, as before the hand lock: these tests jump one hand between poses, which
// the lock would hold as glitches. The lock is tested in record/teleop/handLock.test.ts and
// record/useRecordSession.handLock.test.ts.
vi.mock("../../record/teleop/handLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../record/teleop/handLock")>()),
  HandLock: (await import("../../record/teleop/__fixtures__/passThroughLock")).PassThroughHandLock,
}));
vi.mock("../../record/handArt", () => ({ LazyHandArtOverlay: () => <div data-testid="hand-art-overlay" /> }));
vi.mock("../../record/recordLink", () => ({
  RecordLink: class {
    sent: string[] = [];
    grips: (0 | 1 | undefined)[] = [];
    controls: unknown[] = [];
    closed = false;
    private statusCbs = new Set<(s: TeleopStatus) => void>();
    private simCbs = new Set<(s: SimStatus | null) => void>();
    constructor() {
      links.list.push(this as unknown as FakeLink);
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
  vi.clearAllMocks();
  links.list = [];
});

const connected: TeleopStatus = { socketOpen: true, simConnected: true, lastError: null };
const noSim: TeleopStatus = { socketOpen: true, simConnected: false, lastError: null };
const sim = (over: Partial<SimStatus> = {}): SimStatus => ({ recording: false, steps: 0, demoId: null, lastResult: null, paused: false, ...over });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/record"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MotionProvider>
        <RecordConsole />
      </MotionProvider>
    </MemoryRouter>,
  );
}

async function startCamera() {
  tracker.start.mockResolvedValueOnce(undefined);
  renderPage();
  fireEvent.click(screen.getAllByRole("button", { name: "Start camera" })[0]);
  await screen.findByRole("button", { name: "Stop camera" });
  return links.list[0];
}

function sendHand(t: number, h: TrackedHand | null) {
  const calls = tracker.onFrame.mock.calls as unknown as [(f: HandFrame) => void][];
  const f: HandFrame = { timestamp: t, frameWidth: 640, frameHeight: 480, hands: h ? [h] : [] };
  act(() => calls[calls.length - 1][0](f));
}

function holdFor(t0: number, ms: number, h: TrackedHand) {
  for (let t = t0; t <= t0 + ms; t += 33) sendHand(t, h);
  return t0 + ms + 33;
}

const hand = (opts: HandPoseOptions = {}): TrackedHand => {
  const { world, landmarks } = makeHandPose(opts);
  return { landmarks, worldLandmarks: world, handedness: "Right" };
};

const recordButton = () => screen.getByRole("button", { name: "Record" }) as HTMLButtonElement;
const tile = (name: string) => screen.getByRole("region", { name });

describe("/record", () => {
  it("starts idle: camera off, nothing sent, Record disabled", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Record" })).toBeTruthy();
    expect(screen.getByText(/camera is off/i)).toBeTruthy();
    expect(recordButton().disabled).toBe(true);
    expect(recordButton().getAttribute("aria-pressed")).toBe("false");
    expect(tracker.start).not.toHaveBeenCalled();
    expect(links.list).toHaveLength(0);
  });

  it("explains a blocked camera and opens no link", async () => {
    tracker.start.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Start camera" })[0]);
    expect(await screen.findByText(/camera is blocked/i)).toBeTruthy();
    expect(links.list).toHaveLength(0);
  });

  it("shows the sink command while no sim is connected, and keeps Record and Reset scene disabled", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(noSim));
    expect(screen.getByText(/teleop_sink\.py --viz kit/)).toBeTruthy();
    expect(screen.getByText("sim_link").closest(".rh-chip")?.getAttribute("data-state")).toBe("wait");
    expect(recordButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset scene" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Record sends record_start; the timer is the sim's recorded time; Record again sends record_stop", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    fireEvent.click(recordButton());
    expect(link.sent).toEqual(["record_start"]);
    act(() => link.emitSim(sim({ recording: true, steps: 150 })));
    expect(recordButton().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("timer", { name: "Recording time" }).textContent).toBe("00:03.0");
    expect(within(tile("recorded")).getByText("3.0")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reset scene" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(recordButton());
    expect(link.sent).toEqual(["record_start", "record_stop"]);
  });

  it("links the saved demo to Review and shows the sim's result", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ steps: 376, demoId: "human_20261016_ab12", lastResult: "saved human_20261016_ab12: verified success" })));
    expect(screen.getByRole("link", { name: "Review human_20261016_ab12" }).getAttribute("href")).toBe("/legacy/pm/review?id=human_20261016_ab12");
    expect(screen.getByText("saved human_20261016_ab12: verified success")).toBeTruthy();
  });

  it("shows a paused recording (hand lost) on the record button", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 40, paused: true })));
    expect(recordButton().getAttribute("data-state")).toBe("paused");
    expect(within(tile("episode")).getByText("paused")).toBeTruthy();
  });

  it("sends reset_scene while idle", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    fireEvent.click(screen.getByRole("button", { name: "Reset scene" }));
    expect(link.sent).toEqual(["reset_scene"]);
  });

  it("stops the camera and the link cleanly", async () => {
    const link = await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(link.closed).toBe(true);
    expect(tracker.cleanup).toHaveBeenCalled();
    expect(screen.getByText(/camera is off/i)).toBeTruthy();
  });
});

describe("/record: the rack shows what is sent", () => {
  it("the gripper tile follows hand v4's latch (the grip sent with the pose)", async () => {
    const link = await startCamera();
    sendHand(0, hand());
    expect(link.grips[link.grips.length - 1]).toBe(0);
    expect(within(tile("gripper_cmd")).getByText("0 open")).toBeTruthy();
    holdFor(33, 200, hand({ thumbTip: pinchThumbTip() }));
    expect(link.grips[link.grips.length - 1]).toBe(1);
    expect(within(tile("gripper_cmd")).getByText("1 closed")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Gripper" }).getAttribute("aria-valuetext")).toMatch(/^closed/);
  });

  it("fills the target tiles once a hand is tracked", async () => {
    await startCamera();
    expect(within(tile("ee_target_x")).getByText("—")).toBeTruthy();
    holdFor(0, 200, hand());
    expect(within(tile("ee_target_x")).queryByText("—")).toBeNull();
    expect(screen.getByRole("img", { name: /Palm in the workspace: \d/ })).toBeTruthy();
  });

  it("the V sign held 1.5 s sends reset_scene once and says so", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    holdFor(0, 1600, hand({ fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB }));
    expect(link.sent.filter((a) => a === "reset_scene")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Reset fired" })).toBeTruthy();
  });
});

describe("/record: settings drawer", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));

  it("is closed until the one settings button opens it; Esc closes it and gives focus back", () => {
    renderPage();
    const button = screen.getByRole("button", { name: "Settings" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    open();
    const dialog = screen.getByRole("dialog", { name: "settings" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close settings" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("holds region size, vertical position and calibration; calibration needs the camera", () => {
    renderPage();
    open();
    const dialog = screen.getByRole("dialog", { name: "settings" });
    expect(within(dialog).getByRole("slider", { name: "Region size" })).toBeTruthy();
    expect(within(dialog).getByRole("slider", { name: "Vertical position" })).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Calibrate by hand" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a region change under pm.teleop.region and sends it to the link", async () => {
    const link = await startCamera();
    open();
    fireEvent.change(screen.getByRole("slider", { name: "Region size" }), { target: { value: "0.4" } });
    const saved = JSON.parse(localStorage.getItem(TELEOP_CONTROL_STORAGE_KEY) ?? "null");
    expect(saved.region.width).toBeCloseTo(0.4);
    expect((link.controls[link.controls.length - 1] as typeof DEFAULT_TELEOP_CONTROL).region.width).toBeCloseTo(0.4);
  });

  it("starts Calibrate by hand with the camera on, and Reset to defaults restores the region", async () => {
    await startCamera();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Calibrate by hand" }));
    expect(screen.getByRole("progressbar", { name: "Calibration step progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel calibration" }));
    fireEvent.change(screen.getByRole("slider", { name: "Region size" }), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect((screen.getByRole("slider", { name: "Region size" }) as HTMLInputElement).value).toBe(String(DEFAULT_TELEOP_CONTROL.region.width));
  });
});
