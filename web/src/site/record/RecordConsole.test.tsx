// /record: the hologram Record page on the shared teleop session. The session itself is covered by
// legacy/pm/record/RecordPage.test.tsx (same hook); here: the instruments show what the session
// sends, the record button and its timer, Stop & discard and Delete last demo, the sim notice, the top bar, the
// boot and the drawer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { resetHandoff } from "../holo/handoff";
import type { HandFrame, TrackedHand } from "../../hand/contracts";
import type { SimStatus } from "../../record/recordLink";
import { DEFAULT_TELEOP_CONTROL, TELEOP_CONTROL_STORAGE_KEY } from "../../record/teleop/controlRegion";
import { VICTORY_FLEX, VICTORY_THUMB, makeHandPose, pinchThumbTip, type HandPoseOptions } from "../../record/teleop/__fixtures__/handPoses";
import { EFFECTS_KEY } from "../../sant/motion/effects";
import type { SceneEntry as SceneEntryT, ScenePlanJson as ScenePlanJsonT, TakeReview as TakeReviewT } from "../../pm/types";
import { RecordConsole } from "./RecordConsole";

const tracker = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cleanup: vi.fn(),
  onFrame: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
  stream: vi.fn((): MediaStream | null => null),
}));

type TeleopStatus = { socketOpen: boolean; simConnected: boolean; lastError: string | null };
interface FakeLink {
  sent: string[];
  grips: (0 | 1 | undefined)[];
  controls: unknown[];
  inputs: string[];
  assists: boolean[];
  scenes: string[];
  msgs: unknown[];
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
// The take review: never settles unless a test says otherwise (the page's other fetches stay on the stubbed fetch).
const takeReview = vi.hoisted(() => ({ fn: vi.fn() }));
const sceneApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), save: vi.fn() }));
vi.mock("../../pm/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../pm/api")>();
  return {
    ...actual,
    pmApi: {
      ...actual.pmApi,
      takeReview: (...a: unknown[]) => takeReview.fn(...a),
      listScenes: (...a: unknown[]) => sceneApi.list(...a),
      createScene: (...a: unknown[]) => sceneApi.create(...a),
      saveScene: (...a: unknown[]) => sceneApi.save(...a),
    },
  };
});
vi.mock("../../record/handArt", () => ({ LazyHandArtOverlay: () => <div data-testid="hand-art-overlay" /> }));
// The 3D twin's two sources, faked: three.js never loads, no socket opens, nothing is fetched.
const twin = vi.hoisted(() => ({
  live: { status: "offline", joints: null, gripper: null, cube: null, bin: null, base: null, robot: null } as Record<string, unknown>,
  replay: {
    status: "ready",
    error: null,
    episode: { demoId: "s1_0004_nemotron_m104003" },
    twin: { joints: { panda_joint1: 0.6 }, gripper: 0, cube: null, bin: null },
    base: null,
  } as Record<string, unknown>,
  replayUrl: undefined as string | null | undefined,
}));
vi.mock("../../twin", () => ({
  RobotTwin: ({ caption, joints, aids, facing, interactive = true, contact = null }: { caption?: string; joints: Record<string, number> | null; aids?: boolean; facing?: boolean; interactive?: boolean; contact?: unknown }) => (
    <div data-testid="twin3d" data-joints={JSON.stringify(joints)} data-aids={aids} data-facing={facing ? "true" : "false"} data-interactive={String(interactive)} data-contact={JSON.stringify(contact)}>
      {caption}
    </div>
  ),
  useLiveTwin: () => twin.live,
  useReplayTwin: (_id: string | null, opts?: { url?: string | null }) => {
    twin.replayUrl = opts?.url;
    return twin.replay;
  },
}));
vi.mock("../../record/recordLink", () => ({
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
      links.list.push(this as unknown as FakeLink);
    }
    push(_frame: unknown, grip?: 0 | 1) {
      this.grips.push(grip);
    }
    setControl(s: unknown) {
      this.controls.push(s);
    }
    assists: boolean[] = [];
    scenes: string[] = [];
    sendScene(id: string) {
      this.scenes.push(id);
      return true;
    }
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

// The page's own tests run with the camera; keyboard and mouse have their own block below.
beforeEach(() => {
  localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "camera" }));
  takeReview.fn.mockImplementation(() => new Promise(() => {}));
});

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

  it("says which hand-tracking file failed, never [object Event]", async () => {
    const script = document.createElement("script");
    script.src = "/mediapipe/wasm/vision_wasm_internal.js";
    const failed = new Event("error");
    script.dispatchEvent(failed);
    tracker.start.mockRejectedValueOnce(failed);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Start camera" })[0]);
    expect(await screen.findByText(/couldn't load \/mediapipe\/wasm\/vision_wasm_internal\.js/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("[object Event]");
    expect(links.list).toHaveLength(0);
  });

  it("shows the sink command while no sim is connected, and keeps Record and Reset scene disabled", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(noSim));
    expect(screen.getByText(/teleop_sink_loop.py --viz kit/)).toBeTruthy();
    expect(screen.getByText("sim").closest(".rg-chip")?.getAttribute("data-state")).toBe("wait");
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
    expect(within(tile("episode")).getByText("recording")).toBeTruthy();
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
    expect(within(tile("recorded")).getByText("1")).toBeTruthy();
  });

  it("after Record, runs SANT on the demos saved this visit: the pipeline, with their ids", async () => {
    const link = await startCamera();
    const run = () => screen.getByRole("link", { name: /run sant/i });
    expect(run().getAttribute("href")).toBe("/pipeline");
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ steps: 376, demoId: "human_a", lastResult: "saved human_a" })));
    act(() => link.emitSim(sim({ steps: 200, demoId: "human_b", lastResult: "saved human_b" })));
    expect(run().getAttribute("href")).toBe("/pipeline?demos=human_a,human_b");
    expect(run().textContent).toMatch(/2 demos/);
    // The hand-off to the pipeline (site/holo/handoff.ts): the veil comes up with its name.
    fireEvent.click(run());
    expect(document.querySelector(".holo-handoff")?.textContent).toBe("Pipeline");
    resetHandoff();
  });

  it("Stop & discard shows only while recording and sends record_discard; Record still stops and saves", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    expect(screen.queryByRole("button", { name: "Stop & discard" })).toBeNull();
    fireEvent.click(recordButton());
    act(() => link.emitSim(sim({ recording: true, steps: 50 })));
    fireEvent.click(screen.getByRole("button", { name: "Stop & discard" }));
    expect(link.sent).toEqual(["record_start", "record_discard"]);
    act(() => link.emitSim(sim({ steps: 50, lastResult: "discarded: 50 step(s) not saved" })));
    expect(screen.queryByRole("button", { name: "Stop & discard" })).toBeNull();
    expect(screen.getByText("discarded: 50 step(s) not saved")).toBeTruthy();
    expect(within(tile("recorded")).getByText("0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete last demo" })).toBeNull();
  });

  it("Delete last demo asks once more, then moves the demo away and stops counting it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "human_x", discarded_to: "demos/_discarded/human_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 80 })));
    expect(screen.queryByRole("button", { name: "Delete last demo" })).toBeNull(); // nothing saved yet
    act(() => link.emitSim(sim({ steps: 80, demoId: "human_x", lastResult: "saved human_x: verified success" })));
    expect(within(tile("recorded")).getByText("1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete last demo" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: delete human_x" }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/demos/human_x")).toBe(true);
    expect(init.method).toBe("DELETE");
    expect(within(tile("recorded")).getByText("0")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review human_x" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.getByText("moved to demos/_discarded").getAttribute("title")).toBe("human_x moved to demos/_discarded");
    vi.unstubAllGlobals();
  });

  it("keeps the demo, counted, when the delete is refused, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "demo 'human_x' has derived demos (variant_1); it stays" }), { status: 409 })));
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ steps: 80, demoId: "human_x", lastResult: "saved human_x" })));
    fireEvent.click(screen.getByRole("button", { name: "Delete last demo" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: delete human_x" }));
    });
    expect(screen.getByText("demo 'human_x' has derived demos (variant_1); it stays")).toBeTruthy();
    expect(within(tile("recorded")).getByText("1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review human_x" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete last demo" })).toBeTruthy();
    vi.unstubAllGlobals();
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

describe("/record: the instruments show what is sent", () => {
  it("the gripper tile follows hand v4's latch (the grip sent with the pose)", async () => {
    const link = await startCamera();
    sendHand(0, hand());
    expect(link.grips[link.grips.length - 1]).toBe(0);
    expect(within(tile("gripper_cmd")).getByText("open")).toBeTruthy();
    holdFor(33, 200, hand({ thumbTip: pinchThumbTip() }));
    expect(link.grips[link.grips.length - 1]).toBe(1);
    expect(within(tile("gripper_cmd")).getByText("closed")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Gripper" }).getAttribute("aria-valuetext")).toMatch(/^closed/);
  });

  it("fills the target tiles once a hand is tracked", async () => {
    await startCamera();
    expect(within(tile("ee_x")).getByText("—")).toBeTruthy();
    holdFor(0, 200, hand());
    expect(within(tile("ee_x")).queryByText("—")).toBeNull();
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
    const dialog = screen.getByRole("dialog", { name: "Hand control" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close settings" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("holds region size, vertical position and calibration; calibration needs the camera", () => {
    renderPage();
    open();
    const dialog = screen.getByRole("dialog", { name: "Hand control" });
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

describe("/record: the hologram's top bar and boot", () => {
  it("ejects to the workshop, shows the live sim's robot cartridge and S as the current step", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /workshop/ }).getAttribute("href")).toBe("/");
    expect(screen.getByText("FRANKA")).toBeTruthy();
    expect(screen.getByText("Franka Panda")).toBeTruthy();
    const steps = screen.getByRole("navigation", { name: "SANT steps" });
    // Each step reads in full ("S · show"); on laptop widths only its letter shows (the word stays for screen readers).
    const step = (text: string) => within(steps).getByText((_, el) => !!el?.classList.contains("rg-step") && el.textContent === text);
    expect(step("S · show").getAttribute("aria-current")).toBe("step");
    expect(step("S · show").querySelector(".rg-step__word")?.textContent).toBe(" · show");
    expect(step("T · train").getAttribute("aria-current")).toBeNull();
  });

  it("plugs in once: panes draw in with one scanline sweep, then it's gone", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPage();
      const root = container.querySelector(".rg");
      expect(root?.hasAttribute("data-boot")).toBe(true);
      expect(container.querySelector(".rg-scan")).toBeTruthy();
      act(() => vi.advanceTimersByTime(1700));
      expect(root?.hasAttribute("data-boot")).toBe(false);
      expect(container.querySelector(".rg-scan")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the boot for reduced motion (effects off)", () => {
    localStorage.setItem(EFFECTS_KEY, "off");
    const { container } = renderPage();
    expect(container.querySelector(".rg")?.hasAttribute("data-boot")).toBe(false);
    expect(container.querySelector(".rg-scan")).toBeNull();
  });

  it("replays the demo episode in the 3D twin when no sim streams, with the camera off", () => {
    renderPage();
    expect(twin.replayUrl).toMatch(/world\/demo-episode\.json$/);
    const view = screen.getByTestId("twin3d");
    expect(view.textContent).toBe("replay · verified copy s1_0004_nemotron_m104003");
    expect(view.getAttribute("data-joints")).toBe(JSON.stringify({ panda_joint1: 0.6 }));
    expect(view.getAttribute("data-aids")).toBe("true"); // front, side and top views and the alignment grid
    expect(within(tile("workspace")).getByText("replay")).toBeTruthy();
  });

  it("shows the sim live in the 3D twin when it streams, and stops loading the replay", () => {
    twin.live = { ...twin.live, status: "live", joints: { panda_joint1: -0.3 } };
    try {
      renderPage();
      expect(twin.replayUrl).toBeNull();
      expect(screen.getByTestId("twin3d").textContent).toBe("live from the sim");
      expect(screen.getByTestId("twin3d").getAttribute("data-joints")).toBe(JSON.stringify({ panda_joint1: -0.3 }));
      expect(within(tile("workspace")).getByText("live")).toBeTruthy();
    } finally {
      twin.live = { ...twin.live, status: "offline", joints: null };
    }
  });

  it("shows the dial and the gauges empty until a hand is tracked", async () => {
    await startCamera();
    expect(screen.getByRole("meter", { name: "Arm height" }).getAttribute("aria-valuetext")).toBe("no target");
    expect(screen.getByRole("meter", { name: "Arm left/right" }).getAttribute("aria-valuetext")).toBe("no target");
    holdFor(0, 200, hand());
    expect(screen.getByRole("meter", { name: "Arm height" }).getAttribute("aria-valuetext")).toMatch(/^0\.\d\d m$/);
    expect(screen.getByRole("meter", { name: "Arm left/right" }).getAttribute("aria-valuetext")).toMatch(/^0\.\d\d m to the robot's (left|right)$/);
    expect(within(tile("ee_target_z")).queryByText("—")).toBeNull();
    expect(within(tile("ee_target_y")).queryByText("—")).toBeNull();
  });
});

describe("/record with the keyboard or the mouse (no camera)", () => {
  type Msg = { tracking_ok: boolean; control: [number, number, number]; grip?: 0 | 1 };
  beforeEach(() => {
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "keyboard" }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  });
  afterEach(() => vi.useRealTimers());

  const startKeyboard = () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start keyboard" }));
    return links.list[0];
  };
  const press = (code: string, type: "keyDown" | "keyUp" = "keyDown") => fireEvent[type](window, { code, key: code });

  it("offers Keyboard | Mouse | Camera, keyboard first, with the key legend and the speed", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "Input" });
    expect(within(group).getAllByRole("radio").map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
      ["Keyboard", "true"],
      ["Mouse", "false"],
      ["Camera", "false"],
    ]);
    expect(within(screen.getByRole("list", { name: "Keys" })).getByText("robot's right")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Speed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start camera" })).toBeNull();
  });

  it("starts without the camera or the hand lock, and drives the arm from the keys", () => {
    const link = startKeyboard();
    expect(tracker.start).not.toHaveBeenCalled();
    act(() => link.emitStatus(connected));
    expect(link.inputs).toEqual(["keyboard"]); // the sim is told on connect
    act(() => {
      press("KeyD");
      vi.advanceTimersByTime(1000);
    });
    const msgs = link.msgs as Msg[];
    expect(msgs.length).toBeGreaterThan(25);
    expect(msgs.every((m) => m.tracking_ok)).toBe(true);
    // D: the robot's right, which is u going down (to_ee_target: y = y_min + u * span)
    expect(msgs[msgs.length - 1].control[0]).toBeLessThan(msgs[0].control[0]);
    expect(within(tile("ee_y")).getByText(/^-0\.\d\d$/)).toBeTruthy();
  });

  it("Space toggles the gripper; Enter starts, then stops and saves, telling the sim the input first", () => {
    const link = startKeyboard();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    act(() => {
      press("Space");
      vi.advanceTimersByTime(100);
    });
    expect(link.grips[link.grips.length - 1]).toBe(1);
    act(() => press("Enter"));
    expect(link.sent).toEqual(["record_start"]);
    expect(link.inputs).toEqual(["keyboard", "keyboard"]);
    act(() => link.emitSim(sim({ recording: true, steps: 40 })));
    act(() => press("Enter"));
    expect(link.sent).toEqual(["record_start", "record_stop"]);
  });

  it("Enter does nothing until the sim is connected", () => {
    const link = startKeyboard();
    act(() => press("Enter"));
    expect(link.sent).toEqual([]);
  });

  it("switching the input stops the session; Camera brings the camera back", () => {
    const link = startKeyboard();
    fireEvent.click(screen.getByRole("radio", { name: "Camera" }));
    expect(link.closed).toBe(true);
    expect(screen.getAllByRole("button", { name: "Start camera" }).length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("pm.teleop.drive")!).input).toBe("camera");
  });

  it("mouse mode asks for a click on the twin to take the mouse", () => {
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "mouse" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start mouse" }));
    expect(screen.getByRole("button", { name: "Click here to drive with the mouse · Esc to release" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Mouse sensitivity" })).toBeTruthy();
  });
});

describe("/record with the mouse: a click anywhere on the twin takes the mouse (live test after #10)", () => {
  let pane: HTMLElement;
  beforeEach(() => {
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "mouse" }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    renderPage();
    pane = screen.getByRole("region", { name: "workspace" });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  });

  const locks = () =>
    vi.fn(() => {
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => pane });
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    });
  const refuses = () => vi.fn(() => Promise.reject(new DOMException("The user has exited the lock before this request was completed.", "SecurityError")));
  /** A left click on the twin's canvas, as the browser sends it: pointerdown first. */
  const clickTwin = async () => {
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId("twin3d"), { button: 0 });
    });
  };

  it("shows a centered prompt over the twin, and the twin doesn't orbit in mouse mode", () => {
    expect(within(pane).getByRole("button", { name: "Click here to drive with the mouse · Esc to release" })).toBeTruthy();
    expect(within(pane).getByText(/first click starts the mouse/)).toBeTruthy();
    expect(screen.getByTestId("twin3d").getAttribute("data-interactive")).toBe("false");
  });

  it("the first click starts the mouse session and takes Pointer Lock on the pane; the canvas never gets the click", async () => {
    const lock = locks();
    pane.requestPointerLock = lock as unknown as typeof pane.requestPointerLock;
    const canvasGot = vi.fn();
    screen.getByTestId("twin3d").addEventListener("pointerdown", canvasGot);
    expect(links.list).toHaveLength(0);
    await clickTwin();
    expect(links.list).toHaveLength(1); // started: the relay link is open
    expect(lock).toHaveBeenCalledTimes(1);
    expect(canvasGot).not.toHaveBeenCalled();
    expect(within(pane).queryByRole("button", { name: /Click here to drive/ })).toBeNull(); // locked: the prompt goes
    expect(screen.getByText("mouse · Esc releases")).toBeTruthy();
  });

  it("a refused lock shows why, and the next click asks again", async () => {
    pane.requestPointerLock = refuses() as unknown as typeof pane.requestPointerLock;
    await clickTwin();
    expect(within(pane).getByRole("alert").textContent).toMatch(/refused to lock the mouse \(SecurityError: .*\)\. Click again\./);
    expect(within(pane).getByRole("button", { name: /Click here to drive/ })).toBeTruthy();
    const lock = locks();
    pane.requestPointerLock = lock as unknown as typeof pane.requestPointerLock;
    await clickTwin();
    expect(lock).toHaveBeenCalledTimes(1);
    expect(links.list).toHaveLength(1); // the same session, not a second one
    expect(within(pane).queryByRole("alert")).toBeNull();
  });

  it("a right click or a click while locked doesn't ask again", async () => {
    const lock = locks();
    pane.requestPointerLock = lock as unknown as typeof pane.requestPointerLock;
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId("twin3d"), { button: 2 });
    });
    expect(lock).not.toHaveBeenCalled();
    await clickTwin();
    await clickTwin(); // locked: this click is the gripper (driveSession.ts), not another lock request
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("the keyboard can press the prompt too", async () => {
    const lock = locks();
    pane.requestPointerLock = lock as unknown as typeof pane.requestPointerLock;
    await act(async () => {
      fireEvent.click(within(pane).getByRole("button", { name: /Click here to drive/ }), { detail: 0 });
    });
    expect(lock).toHaveBeenCalledTimes(1);
  });
});

describe("/record with the camera: sensitivity, the clutch, the gripper input and the view (live test after #10)", () => {
  type Sent = { control?: [number, number, number]; tracking_ok: boolean };
  const lastControl = (link: FakeLink) => (link.msgs as Sent[]).filter((m) => m.tracking_ok).slice(-1)[0].control!;
  const at = (x: number) => hand({ center: { x, y: 0.45 } });

  it("shows the Sensitivity slider in the console, not only in the drawer, and saves it", async () => {
    await startCamera();
    const slider = screen.getByRole("slider", { name: "Sensitivity" }) as HTMLInputElement;
    expect(slider.value).toBe("1");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(JSON.parse(localStorage.getItem(TELEOP_CONTROL_STORAGE_KEY)!).gain).toBe(2);
  });

  it("holding Shift is the clutch: the target freezes, a quiet clutch caption shows, and letting go carries on with no jump", async () => {
    const link = await startCamera();
    let t = holdFor(0, 200, at(0.5));
    const before = lastControl(link)[0];
    act(() => void fireEvent.keyDown(window, { key: "Shift", code: "ShiftLeft" }));
    expect(screen.getByText(/^clutch: the arm holds still/)).toBeTruthy();
    t = holdFor(t, 300, at(0.35)); // the hand moves to the user's right while clutched
    expect(lastControl(link)[0]).toBeCloseTo(before, 6);
    act(() => void fireEvent.keyUp(window, { key: "Shift", code: "ShiftLeft" }));
    expect(screen.queryByText(/^clutch: the arm holds still/)).toBeNull();
    t = holdFor(t, 33, at(0.35));
    expect(Math.abs(lastControl(link)[0] - before)).toBeLessThan(0.02); // no jump on release
    holdFor(t, 300, at(0.3)); // then follows the hand from where it is now
    expect(lastControl(link)[0]).toBeLessThan(before - 0.02);
  });

  it("with the spacebar as the gripper input, Space toggles the grip and a pinch does not", async () => {
    localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, gripperInput: "space" }));
    const link = await startCamera();
    holdFor(0, 200, hand({ thumbTip: pinchThumbTip() }));
    expect(link.grips[link.grips.length - 1]).toBe(0);
    act(() => void fireEvent.keyDown(window, { key: " ", code: "Space" }));
    sendHand(300, hand());
    expect(link.grips[link.grips.length - 1]).toBe(1);
    expect(screen.getByText(/space = grip/)).toBeTruthy();
  });

  it("the Robot's view (behind the robot) is on by default; off is the mirror, and the twin turns round with it", async () => {
    await startCamera();
    expect(screen.getByTestId("twin3d").getAttribute("data-facing")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const behind = screen.getByRole("checkbox", { name: /Robot's view \(behind the robot\)/ }) as HTMLInputElement;
    expect(behind.checked).toBe(true);
    fireEvent.click(behind);
    expect(JSON.parse(localStorage.getItem(TELEOP_CONTROL_STORAGE_KEY)!).view).toBe("facing");
    expect(screen.getByTestId("twin3d").getAttribute("data-facing")).toBe("true");
  });

  it("the drawer sets the gripper input and the clutch key", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Gripper" }), { target: { value: "space" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Clutch key" }), { target: { value: "Control" } });
    const s = JSON.parse(localStorage.getItem(TELEOP_CONTROL_STORAGE_KEY)!);
    expect([s.gripperInput, s.clutchKey]).toEqual(["space", "Control"]);
  });
});

describe("/record with the camera: Save camera video (for the offline hand refine)", () => {
  class FakeMediaRecorder {
    static made: FakeMediaRecorder[] = [];
    static isTypeSupported = () => true;
    mimeType = "video/webm;codecs=vp9";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstart: (() => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly stream: MediaStream) {
      FakeMediaRecorder.made.push(this);
    }
    start() {
      this.onstart?.();
    }
    stop() {
      this.ondataavailable?.({ data: new Blob(["webm bytes"]) });
      this.onstop?.();
    }
  }
  const camStream = { getVideoTracks: () => [] } as unknown as MediaStream;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeMediaRecorder.made = [];
    tracker.stream.mockReturnValue(camStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ id: url.split("/")[4], video: "x", bytes: 10, frames: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    tracker.stream.mockReturnValue(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Camera on, sim connected, its last saved demo human_prev; then the clock is fake (performance.now() = 0). */
  async function ready() {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ demoId: "human_prev" })));
    vi.useFakeTimers({ toFake: ["performance"] });
    return link;
  }

  it("is on by default in the drawer, and saving the take uploads its video with the demo the sim saved", async () => {
    const link = await ready();
    fireEvent.click(recordButton());
    expect(FakeMediaRecorder.made.map((r) => r.stream)).toEqual([camStream]); // the camera's own stream
    act(() => link.emitSim(sim({ recording: true, steps: 10, demoId: "human_prev" })));
    vi.advanceTimersByTime(100);
    sendHand(performance.now(), hand());
    vi.advanceTimersByTime(33);
    sendHand(performance.now(), hand());
    vi.advanceTimersByTime(367);
    fireEvent.click(recordButton());
    expect(fetchMock).not.toHaveBeenCalled(); // not until the sim names the demo
    act(() => link.emitSim(sim({ steps: 25, demoId: "human_new", lastResult: "saved human_new" })));
    await screen.findByText("camera video saved: demos/human_new/camera.webm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/demos\/human_new\/camera$/);
    expect(init.method).toBe("PUT");
    const form = init.body as FormData;
    expect(await (form.get("video") as Blob).text()).toBe("webm bytes");
    const timing = JSON.parse(form.get("timing") as string);
    expect(timing).toMatchObject({ clock: "performance.now", start_ms: 0, stop_ms: 500, t_ms: [100, 133], video_s: [0.1, 0.133] });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect((screen.getByRole("checkbox", { name: /^Save camera video/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("Stop & discard saves no video", async () => {
    const link = await ready();
    fireEvent.click(recordButton());
    act(() => link.emitSim(sim({ recording: true, steps: 10, demoId: "human_prev" })));
    fireEvent.click(screen.getByRole("button", { name: "Stop & discard" }));
    act(() => link.emitSim(sim({ steps: 10, demoId: null, lastResult: "discarded: 10 step(s) not saved" })));
    expect(screen.getByText("camera video discarded with the take")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the setting off, nothing is recorded", async () => {
    localStorage.setItem(TELEOP_CONTROL_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TELEOP_CONTROL, saveVideo: false }));
    const link = await ready();
    fireEvent.click(recordButton());
    act(() => link.emitSim(sim({ recording: true, steps: 10, demoId: "human_prev" })));
    fireEvent.click(recordButton());
    act(() => link.emitSim(sim({ steps: 25, demoId: "human_new" })));
    expect(FakeMediaRecorder.made).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keyboard and mouse takes never record the camera", async () => {
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "keyboard" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start keyboard" }));
    const link = links.list[0];
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim()));
    fireEvent.click(recordButton());
    expect(link.sent).toEqual(["record_start"]);
    expect(FakeMediaRecorder.made).toEqual([]);
  });
});

describe("/record: the contact glow and the soft floor (pm/record-contact)", () => {
  beforeEach(() => localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "keyboard" })));
  afterEach(() => {
    twin.live = { status: "offline", joints: null, gripper: null, cube: null, bin: null, base: null, robot: null };
  });
  const startKeyboard = () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start keyboard" }));
    return links.list[0];
  };
  const floorBox = () => screen.getByRole("checkbox", { name: "soft floor" }) as HTMLInputElement;

  it("the soft floor is on by default, goes to the sim when it connects and before each recording", () => {
    const link = startKeyboard();
    expect(floorBox().checked).toBe(true);
    act(() => link.emitStatus(connected));
    expect(link.assists).toEqual([true]);
    act(() => link.emitSim(sim()));
    fireEvent.click(recordButton());
    expect(link.sent).toEqual(["record_start"]);
    expect(link.assists).toEqual([true, true]);
  });

  it("unticking it tells the sim at once and is saved; the next session starts with it off", () => {
    const link = startKeyboard();
    act(() => link.emitStatus(connected));
    fireEvent.click(floorBox());
    expect(link.assists).toEqual([true, false]);
    expect(JSON.parse(localStorage.getItem("pm.teleop.drive")!).softFloor).toBe(false);
    expect(link.closed).toBe(false); // not an input switch: the session carries on
    cleanup();
    links.list = [];
    const next = startKeyboard();
    act(() => next.emitStatus(connected));
    expect(next.assists).toEqual([false]);
  });

  it("live, the twin gets the push to glow and the force bar shows it with the take's peak and the floor", () => {
    const contact = { forceN: 312, body: "panda_hand", against: "bin" };
    twin.live = { ...twin.live, status: "live", joints: { panda_joint1: 0 }, contact, floor: true };
    const link = startKeyboard();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim({ ...sim({ recording: true, steps: 40 }), contactPeakN: 927 }));
    expect(screen.getByTestId("twin3d").getAttribute("data-contact")).toBe(JSON.stringify(contact));
    const bar = screen.getByRole("meter", { name: "Arm contact force" });
    expect(bar.getAttribute("aria-valuetext")).toBe("312 N · hand on the bin");
    expect(bar.closest(".rg-force")!.getAttribute("data-level")).toBe("collision");
    expect(screen.getByText("peak 927 N")).toBeTruthy();
    expect(screen.getByText("soft floor holding")).toBeTruthy();
  });

  it("no force bar on the replay (no live contact)", () => {
    renderPage();
    expect(screen.queryByRole("meter", { name: "Arm contact force" })).toBeNull();
    expect(screen.getByTestId("twin3d").getAttribute("data-contact")).toBe("null");
  });

  it("in mouse mode a click on the soft floor box stays a click, it doesn't take the mouse", async () => {
    cleanup();
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "mouse" }));
    renderPage();
    const pane = screen.getByRole("region", { name: "workspace" });
    const lock = vi.fn();
    pane.requestPointerLock = lock as unknown as typeof pane.requestPointerLock;
    await act(async () => {
      fireEvent.pointerDown(floorBox(), { button: 0 });
      fireEvent.click(floorBox());
    });
    expect(lock).not.toHaveBeenCalled();
    expect(floorBox().checked).toBe(false);
  });
});

describe("/record: the take review after each save (pm/take-review)", () => {
  const review = (over: Partial<TakeReviewT> = {}): TakeReviewT => ({
    demo_id: "human_a",
    verdict: "PASS",
    lines: ["Clean take: the cube is in the bin (8.3 s).", "No pushing; the floor held you for 0.8 s.", "Grab 6 mm off-centre."],
    source: "rules",
    rejected: null,
    facts: {
      success: true, reasons: [], duration_s: 8.3, peak_force_n: 0, peak_force_t: null, peak_force_against: null,
      soft_floor: true, soft_floor_steps: 39, soft_floor_s: 0.8, soft_floor_dips: null, grabs: [{ t: 3.62, offset_mm: 6, caught: true }], releases: [], regrasps: 0, input: "mouse",
    },
    ...over,
  });
  const coachCell = () => screen.getByRole("region", { name: "take review" });

  async function saveTake(id = "human_a") {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 80 })));
    await act(async () => link.emitSim(sim({ steps: 80, demoId: id, lastResult: `saved ${id}: verified success` })));
    return link;
  }

  it("shows PASS and the coaching lines in the trace's cell once the take is saved", async () => {
    takeReview.fn.mockResolvedValue(review());
    const link = await saveTake();
    expect(takeReview.fn).toHaveBeenCalledWith("human_a");
    expect(within(coachCell()).getByText("PASS")).toBeTruthy();
    expect(within(coachCell()).getByRole("list", { name: "Coaching" }).textContent).toContain("No pushing; the floor held you for 0.8 s.");
    expect(screen.queryByRole("region", { name: "trace" })).toBeNull();
    // the next recording brings the trace back
    act(() => link.emitSim(sim({ recording: true, steps: 3, demoId: "human_a" })));
    expect(screen.getByRole("region", { name: "trace" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "take review" })).toBeNull();
  });

  it("says FAIL for a take the check fails", async () => {
    takeReview.fn.mockResolvedValue(review({ verdict: "FAIL", lines: ["Not verified: the arm pushed over 5 N.", "Pushed 927 N into the bin at 7.8 s."] }));
    await saveTake();
    expect(within(coachCell()).getByText("FAIL").getAttribute("data-verdict")).toBe("FAIL");
    expect(within(coachCell()).getByText("Pushed 927 N into the bin at 7.8 s.")).toBeTruthy();
  });

  it("shows that it is reviewing, and a quiet line if the review can't be had", async () => {
    await saveTake();
    expect(within(coachCell()).getByText("reviewing…")).toBeTruthy();
    cleanup();
    links.list = [];
    takeReview.fn.mockRejectedValue(new Error("Can't reach the backend"));
    await saveTake();
    expect(within(coachCell()).getByText("no review")).toBeTruthy();
    expect(within(coachCell()).getByText("Can't reach the backend")).toBeTruthy();
  });

  it("Delete last demo still works, and the deleted take's review goes with it", async () => {
    takeReview.fn.mockResolvedValue(review());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "human_a", discarded_to: "demos/_discarded/human_a" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await saveTake();
      expect(coachCell()).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete last demo" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Confirm: delete human_a" }));
      });
      expect(fetchMock).toHaveBeenCalledTimes(1); // the delete; the review didn't go through fetch
      expect(screen.queryByRole("region", { name: "take review" })).toBeNull();
      expect(screen.getByRole("region", { name: "trace" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Stop & discard asks for no review", async () => {
    const link = await startCamera();
    act(() => link.emitStatus(connected));
    act(() => link.emitSim(sim({ recording: true, steps: 50 })));
    fireEvent.click(screen.getByRole("button", { name: "Stop & discard" }));
    expect(link.sent).toEqual(["record_discard"]);
    act(() => link.emitSim(sim({ steps: 50, demoId: null, lastResult: "discarded: 50 step(s) not saved" })));
    expect(takeReview.fn).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "take review" })).toBeNull();
  });
});

describe("/record: the scene picker (pm/record-scenes)", () => {
  const cube = (id: string, color: string, x: number, y: number, size = 0.05) =>
    ({ id, kind: "cube" as const, color, size, pose: { x, y, yaw_deg: 0 }, on: null });
  const bin = (x: number, y: number, yaw = 0, h = 0.08) =>
    ({ id: "bin", kind: "bin" as const, color: "blue", inner: [0.2, 0.2, h] as [number, number, number], pose: { x, y, yaw_deg: yaw } });
  const plan = (objects: ScenePlanJsonT["objects"]): ScenePlanJsonT =>
    ({ version: 1, robot: "franka", objects, goals: [{ object: "cube", bin: "bin" }], reach: { x: [0.4, 0.65], y: [-0.3, 0.3], z_max: 0.25 } });
  const entry = (id: string, name: string, p: ScenePlanJsonT, needs = false): SceneEntryT => ({
    id, name, description: `${name}, described`, source: id === "standard" ? "standard" : "protocol", plan: p,
    hash: "0123456789abcdef", needs_settle: needs, settle: null, created_at: "2026-10-20T00:00:00+00:00",
  });
  const SCENES = [
    entry("standard", "Standard", plan([cube("cube", "red", 0.5, 0), bin(0.5, 0.3)])),
    entry("s3", "S3 Bin turned, other side", plan([cube("cube", "red", 0.5, 0), bin(0.55, -0.2, 90)])),
    entry("s7", "S7 Yellow distractor", plan([cube("cube", "red", 0.5, 0), cube("distractor", "yellow", 0.5, -0.085), bin(0.5, 0.3)]), true),
  ];

  beforeEach(() => {
    localStorage.setItem("pm.teleop.drive", JSON.stringify({ input: "keyboard" }));
    sceneApi.list.mockResolvedValue(SCENES);
  });

  async function openPicker() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start keyboard" }));
    const link = links.list[0];
    act(() => link.emitStatus(connected));
    act(() => link.emitSim({ ...sim(), scene: { id: "standard", name: "Standard", hash: "0123456789abcdef", settle: null, switching: null, playlist: null } }));
    fireEvent.click(screen.getByRole("button", { name: /^Scene/ }));
    await screen.findByRole("button", { name: /S3 Bin turned/ });
    return link;
  }
  const drawer = () => screen.getByRole("dialog", { name: "Scenes" });

  it("lists the scenes, marks the live one, and previews the one you pick", async () => {
    await openPicker();
    expect(screen.getByRole("button", { name: /^Scene · Standard/ })).toBeTruthy();
    const list = within(drawer()).getByRole("list", { name: "Scenes" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Standard"), expect.stringContaining("S3 Bin turned"), expect.stringContaining("S7 Yellow distractor"),
    ]);
    fireEvent.click(within(list).getByRole("button", { name: /S7 Yellow distractor/ }));
    const preview = within(drawer()).getByRole("img", { name: /Scene preview: 2 cubes, 1 bin/ });
    expect(preview.querySelectorAll("[data-object]").length).toBe(3);
    expect(within(drawer()).getByText(/new bodies: the sim restarts and checks it in Isaac/)).toBeTruthy();
  });

  it("Use this scene asks the sim for it; not while recording, not for the live one", async () => {
    const link = await openPicker();
    const use = () => within(drawer()).getByRole("button", { name: "Use this scene" }) as HTMLButtonElement;
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Standard/ }));
    expect(use().disabled).toBe(true); // already live
    fireEvent.click(within(drawer()).getByRole("button", { name: /S3 Bin turned/ }));
    fireEvent.click(use());
    expect(link.scenes).toEqual(["s3"]);
    act(() => link.emitSim({ ...sim({ recording: true, steps: 3 }), scene: { id: "standard", name: "Standard", hash: "0123456789abcdef", settle: null, switching: null, playlist: null } }));
    expect(use().disabled).toBe(true);
  });

  it("says when the sim is restarting into a scene, and when a settle check failed", async () => {
    const link = await openPicker();
    act(() => link.emitSim({ ...sim(), scene: { id: "standard", name: "Standard", hash: "0123456789abcdef", settle: null, switching: "s7", playlist: null } }));
    expect(within(drawer()).getByRole("status").textContent).toMatch(/switching to s7: the sim restarts/);
    act(() => link.emitSim({ ...sim(), scene: { id: "s8", name: "S8 Taller bin", hash: "0123456789abcdef", settle: { ok: false, errors: ["cube moved 2 cm"] }, switching: null, playlist: { index: 7, of: 12, take: 1, takesPerScene: 2 } } }));
    expect(screen.getByRole("button", { name: /^Scene · S8 Taller bin/ })).toBeTruthy();
    expect(within(drawer()).getByRole("alert").textContent).toMatch(/settle check failed: cube moved 2 cm/);
    expect(within(drawer()).getByText("scene list 8 of 12 · take 2 of 2")).toBeTruthy();
  });

  it("describe a scene: Nemotron's plan is previewed, then saved and used", async () => {
    const link = await openPicker();
    const draft = plan([cube("cube", "red", 0.5, 0), cube("distractor", "green", 0.5, -0.1), bin(0.5, 0.3)]);
    sceneApi.create.mockResolvedValue({ ok: true, plan: draft, errors: [], needs_settle: true, calls: 1, model: "nemotron" });
    sceneApi.save.mockResolvedValue(entry("green_one_ab12cd", "a green cube beside it", draft, true));
    fireEvent.change(within(drawer()).getByRole("textbox", { name: "Describe a scene" }), { target: { value: "a green cube beside it" } });
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole("button", { name: "Create with Nemotron" }));
    });
    expect(sceneApi.create).toHaveBeenCalledWith("a green cube beside it");
    expect(within(drawer()).getByRole("img", { name: /Scene preview: 2 cubes, 1 bin/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole("button", { name: "Save & use" }));
    });
    expect(sceneApi.save).toHaveBeenCalledWith("a green cube beside it", draft, "a green cube beside it");
    expect(link.scenes).toEqual(["green_one_ab12cd"]);
  });

  it("a description Nemotron can't make valid shows why and offers nothing to save", async () => {
    await openPicker();
    sceneApi.create.mockResolvedValue({ ok: false, plan: null, errors: ["bin is out of reach"], needs_settle: null, calls: 4, model: "nemotron" });
    fireEvent.change(within(drawer()).getByRole("textbox", { name: "Describe a scene" }), { target: { value: "a bin on the moon" } });
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole("button", { name: "Create with Nemotron" }));
    });
    expect(within(drawer()).getByText(/bin is out of reach/)).toBeTruthy();
    expect(within(drawer()).queryByRole("button", { name: "Save & use" })).toBeNull();
  });
});
