// The keyboard and the mouse on /record, wired to a Drive (drive.ts): window key listeners, the mouse under Pointer
// Lock, and a loop at the camera path's rate (TICK_S) that steps the Drive and hands each HandPoseMsg to the page,
// which sends it through the same TeleopClient as the camera's.
//
// Keys (KeyboardEvent.code, so any layout's physical WASD): W/S A/D R/F and the arrows move, Space toggles the
// gripper, Enter asks the page to start or stop recording, Shift held is the fine mode. Keys go to a text field (or
// arrows to a focused slider) instead while you type there; every key used here has its default prevented, so a
// focused button isn't pressed as well. The window losing focus forgets held keys, so the arm can't run away.
// The mouse drives only while its pane holds Pointer Lock (requestMouse; Esc releases it): movement in the
// horizontal plane, the wheel up/down, a left click the gripper.

import type { HandPoseMsg } from "../teleop/handPoseMessage";
import { Drive, MOVE_CODES, TICK_S, driveMessage, keyAxes, mouseDelta, wheelDelta, type DriveSettings } from "./drive";

export interface DriveUi {
  msg: HandPoseMsg;
  gripper: 0 | 1;
  fine: boolean;
  locked: boolean; // the mouse holds Pointer Lock
}

export interface DriveHooks {
  send(msg: HandPoseMsg, grip: 0 | 1): void;
  ui(state: DriveUi): void; // ~10 Hz, and at once when the gripper, fine mode or the lock changes
  enter(): void; // Enter: start or stop recording
  settings(): DriveSettings;
}

const UI_MS = 100;
const SHIFTS = ["ShiftLeft", "ShiftRight"];
const TEXT_INPUTS = new Set(["text", "search", "email", "number", "password", "tel", "url"]);

/** Whether a key on this element belongs to it: typing, or arrows on a slider. */
function typingIn(target: EventTarget | null, code: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return TEXT_INPUTS.has(type) || (type === "range" && code.startsWith("Arrow"));
}

export class DriveSession {
  readonly drive = new Drive();
  private readonly held = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastUi = -Infinity;
  private lockEl: Element | null = null;
  private shown: Omit<DriveUi, "msg"> | null = null;

  constructor(private readonly hooks: DriveHooks) {}

  start() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("pointerlockchange", this.onLockChange);
    this.lastTick = performance.now();
    this.timer = setInterval(this.tick, TICK_S * 1000);
  }

  stop() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.held.clear();
    if (this.locked) document.exitPointerLock?.();
    this.lockEl = null;
  }

  /** Mouse mode: take Pointer Lock on this element (a click on the twin pane). */
  requestMouse(el: HTMLElement) {
    this.lockEl = el;
    void Promise.resolve(el.requestPointerLock?.()).catch(() => {}); // refused (no gesture, sandbox): stays unlocked
  }

  /** Reset scene: the target goes home with the robot. */
  reset() {
    this.drive.reset();
  }

  private get locked(): boolean {
    return this.lockEl !== null && document.pointerLockElement === this.lockEl;
  }

  private get fine(): boolean {
    return SHIFTS.some((c) => this.held.has(c));
  }

  private readonly tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const pos = this.drive.step(dt, keyAxes(this.held), { speed: this.hooks.settings().speed, fine: this.fine });
    const msg = driveMessage(pos, this.drive.gripper, now);
    this.hooks.send(msg, this.drive.gripper);
    this.report(msg, now);
  };

  private report(msg: HandPoseMsg, now: number, force = false) {
    const state = { gripper: this.drive.gripper, fine: this.fine, locked: this.locked };
    const changed = !this.shown || state.gripper !== this.shown.gripper || state.fine !== this.shown.fine || state.locked !== this.shown.locked;
    if (!force && !changed && now - this.lastUi < UI_MS) return;
    this.lastUi = now;
    this.shown = state;
    this.hooks.ui({ msg, ...state });
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (typingIn(e.target, e.code)) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) this.drive.toggleGripper();
    } else if (e.code === "Enter") {
      e.preventDefault();
      if (!e.repeat) this.hooks.enter();
    } else if (MOVE_CODES.includes(e.code) || SHIFTS.includes(e.code)) {
      if (MOVE_CODES.includes(e.code)) e.preventDefault();
      this.held.add(e.code);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    if (e.code === "Space" || e.code === "Enter") e.preventDefault(); // a focused button would click on keyup
  };

  private readonly onBlur = () => this.held.clear();

  private readonly onMouseMove = (e: MouseEvent) => {
    if (this.locked) this.drive.nudge(mouseDelta(e.movementX ?? 0, e.movementY ?? 0, this.hooks.settings().mouseSens, this.fine));
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    const notch = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY; // lines, pages -> px
    this.drive.nudge(wheelDelta(notch, this.fine));
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (this.locked && e.button === 0) this.drive.toggleGripper();
  };

  private readonly onLockChange = () => {
    if (!this.locked) this.lockEl = document.pointerLockElement ? this.lockEl : null;
    const pos = this.drive.pos;
    this.report(driveMessage(pos, this.drive.gripper, performance.now()), performance.now(), true);
  };
}
