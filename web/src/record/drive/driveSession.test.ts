// DriveSession: the keyboard and mouse wired to the page (listeners, the ~30 Hz loop, typing, Pointer Lock).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toTarget } from "../../site/record-hud/hudModel";
import type { HandPoseMsg } from "../teleop/handPoseMessage";
import { DEFAULT_DRIVE, HOME, TICK_S, type DriveSettings } from "./drive";
import { DriveSession, type DriveUi } from "./driveSession";

let sent: { msg: HandPoseMsg; grip?: 0 | 1 }[];
let uis: DriveUi[];
let enters: number;
let settings: DriveSettings;
let session: DriveSession;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  sent = [];
  uis = [];
  enters = 0;
  settings = { ...DEFAULT_DRIVE };
  session = new DriveSession({
    send: (msg, grip) => sent.push({ msg, grip }),
    ui: (u) => uis.push(u),
    enter: () => enters++,
    settings: () => settings,
  });
  session.start();
});

afterEach(() => {
  session.stop();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const key = (type: "keydown" | "keyup", code: string, opts: KeyboardEventInit = {}, target: EventTarget = window) => {
  const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
};
const ticks = (s: number) => vi.advanceTimersByTime(Math.round(s * 1000));
const lastTarget = () => toTarget(sent[sent.length - 1].msg).ee;

describe("DriveSession", () => {
  it("sends a tracked message every tick (~30 Hz), from home, with the gripper open", () => {
    ticks(1);
    expect(sent.length).toBeGreaterThanOrEqual(28);
    expect(sent.length).toBeLessThanOrEqual(31);
    expect(sent.every((s) => s.msg.tracking_ok && s.grip === 0)).toBe(true);
    expect(lastTarget()[0]).toBeCloseTo(HOME[0], 9);
  });

  it("W held drives forward; letting go ramps to a stop", () => {
    const k = key("keydown", "KeyW");
    expect(k.defaultPrevented).toBe(true); // the page doesn't scroll
    ticks(1);
    const x1 = lastTarget()[0];
    expect(x1).toBeGreaterThan(HOME[0] + 0.05);
    key("keyup", "KeyW");
    ticks(1);
    const x2 = lastTarget()[0];
    ticks(0.5);
    expect(lastTarget()[0]).toBeCloseTo(x2, 9); // stopped
    expect(x2).toBeGreaterThan(x1); // it coasted down the ramp, no dead stop
  });

  it("Space toggles the gripper once per press (not on key repeat)", () => {
    key("keydown", "Space");
    key("keydown", "Space", { repeat: true });
    key("keyup", "Space");
    ticks(TICK_S * 2);
    expect(sent[sent.length - 1].grip).toBe(1);
    key("keydown", "Space");
    ticks(TICK_S * 2);
    expect(sent[sent.length - 1].grip).toBe(0);
  });

  it("Enter asks the page to start or stop recording", () => {
    const e = key("keydown", "Enter");
    key("keydown", "Enter", { repeat: true });
    expect(enters).toBe(1);
    expect(e.defaultPrevented).toBe(true); // a focused button isn't clicked as well
  });

  it("Shift is the fine mode", () => {
    key("keydown", "ShiftLeft", { shiftKey: true });
    key("keydown", "KeyD", { shiftKey: true });
    ticks(1);
    const fine = HOME[1] - lastTarget()[1];
    session.drive.reset();
    key("keyup", "ShiftLeft");
    ticks(0.01);
    const before = lastTarget()[1];
    ticks(1);
    expect(before - lastTarget()[1]).toBeGreaterThan(2 * fine);
    expect(uis.some((u) => u.fine)).toBe(true);
  });

  it("uses the speed slider's speed", () => {
    settings = { ...settings, speed: 0.2 };
    key("keydown", "KeyF"); // down: home is 33 cm above the table, plenty of room
    ticks(1);
    expect(session.drive.vel[2]).toBeCloseTo(-0.2, 6);
  });

  it("ignores keys while typing in a text field, and arrows on a focused slider", () => {
    const text = document.body.appendChild(document.createElement("input"));
    const e = key("keydown", "KeyW", {}, text);
    expect(e.defaultPrevented).toBe(false);
    const slider = Object.assign(document.body.appendChild(document.createElement("input")), { type: "range" });
    key("keydown", "ArrowUp", {}, slider);
    key("keydown", "Space", {}, text);
    ticks(1);
    expect(lastTarget()[0]).toBeCloseTo(HOME[0], 9);
    expect(sent[sent.length - 1].grip).toBe(0);
    key("keydown", "KeyW", {}, slider); // W is not the slider's key
    ticks(0.5);
    expect(lastTarget()[0]).toBeGreaterThan(HOME[0]);
  });

  it("forgets held keys when the window loses focus, so the arm can't run away", () => {
    key("keydown", "KeyW");
    ticks(0.5);
    window.dispatchEvent(new Event("blur"));
    ticks(1);
    const x = lastTarget()[0];
    ticks(0.5);
    expect(lastTarget()[0]).toBeCloseTo(x, 9);
  });

  it("stop() removes the listeners and the loop", () => {
    session.stop();
    const n = sent.length;
    key("keydown", "KeyW");
    ticks(1);
    expect(sent.length).toBe(n);
  });
});

describe("DriveSession with the mouse (Pointer Lock)", () => {
  let pane: HTMLElement;
  beforeEach(() => {
    pane = document.body.appendChild(document.createElement("div"));
    pane.requestPointerLock = vi.fn(() => {
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => pane });
      document.dispatchEvent(new Event("pointerlockchange"));
    }) as unknown as typeof pane.requestPointerLock;
  });
  afterEach(() => {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  });

  const move = (dx: number, dy: number) => document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: dx, movementY: dy }));

  it("does nothing until the pane is clicked into Pointer Lock", () => {
    move(0, -300);
    ticks(1);
    expect(lastTarget()[0]).toBeCloseTo(HOME[0], 9);
    session.requestMouse(pane);
    expect(pane.requestPointerLock).toHaveBeenCalled();
    expect(uis[uis.length - 1].locked).toBe(true);
  });

  it("mouse up drives forward, mouse right the robot's right, the wheel up/down, a click the gripper", () => {
    session.requestMouse(pane);
    move(0, -100);
    move(100, 0);
    document.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    ticks(2);
    const [x, y, z] = lastTarget();
    const s = DEFAULT_DRIVE.mouseSens;
    expect(x).toBeCloseTo(HOME[0] + 100 * s, 3);
    expect(y).toBeCloseTo(HOME[1] - 100 * s, 3);
    expect(z).toBeGreaterThan(HOME[2] - 0.0001); // up, though HOME is near the top: clamped at 0.40
    expect(sent[sent.length - 1].grip).toBe(1);
  });

  it("releasing the lock (Esc) stops the mouse driving", () => {
    session.requestMouse(pane);
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
    document.dispatchEvent(new Event("pointerlockchange"));
    move(0, -300);
    ticks(1);
    expect(lastTarget()[0]).toBeCloseTo(HOME[0], 9);
    expect(uis[uis.length - 1].locked).toBe(false);
  });
});

describe("DriveSession: a refused Pointer Lock says why", () => {
  let pane: HTMLElement;
  beforeEach(() => {
    pane = document.body.appendChild(document.createElement("div"));
  });
  afterEach(() => {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  });
  const lockOk = () =>
    vi.fn(() => {
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => pane });
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    }) as unknown as typeof pane.requestPointerLock;
  const refuse = (name: string, message: string) =>
    vi.fn(() => Promise.reject(new DOMException(message, name))) as unknown as typeof pane.requestPointerLock;

  it("resolves null once locked", async () => {
    pane.requestPointerLock = lockOk();
    await expect(session.requestMouse(pane)).resolves.toBeNull();
    expect(uis[uis.length - 1].locked).toBe(true);
  });

  it("resolves the browser's reason when the promise is rejected, and stays unlocked", async () => {
    pane.requestPointerLock = refuse("NotAllowedError", "The root document of this element is not valid for pointer lock.");
    const reason = await session.requestMouse(pane);
    expect(reason).toMatch(/refused to lock the mouse \(NotAllowedError: The root document/);
    expect(reason).toMatch(/Click again\.$/);
    expect(document.pointerLockElement).toBeNull();
  });

  it("an older browser's pointerlockerror event is a refusal too", async () => {
    pane.requestPointerLock = vi.fn(() => {
      document.dispatchEvent(new Event("pointerlockerror"));
    }) as unknown as typeof pane.requestPointerLock;
    await expect(session.requestMouse(pane)).resolves.toMatch(/^The browser refused to lock the mouse\. Click again\.$/);
  });

  it("right after Esc it says the browser needs a moment; a later click locks", async () => {
    pane.requestPointerLock = lockOk();
    await session.requestMouse(pane);
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null }); // Esc
    document.dispatchEvent(new Event("pointerlockchange"));
    pane.requestPointerLock = refuse("SecurityError", "The user has exited the lock before this request was completed.");
    await expect(session.requestMouse(pane)).resolves.toMatch(/needs a second after Esc/);
    vi.advanceTimersByTime(2000);
    pane.requestPointerLock = lockOk();
    await expect(session.requestMouse(pane)).resolves.toBeNull();
  });
});
