// Idle loops (the drifting particles, the machine's fans, the hero's 4D turn) ask for frames through ambient(): at
// full rate while the visitor is doing something, and at the idle rate once nothing has happened for a few seconds:
// 60 fps on high and ultra, 30 on low (setIdleFps; WorldCanvas sets it for the tier). A slow drift reads the same,
// and an idle page costs the GPU half as much on a 120 Hz screen. The idle frames are paced by the display's own
// frames (requestAnimationFrame), not a timer: a 33 ms timer waits for the next frame after it and lands nearer 25.
const IDLE_AFTER_MS = 3000;

let idleFrameMs = 1000 / 60;
let last = typeof performance !== "undefined" ? performance.now() : 0;
let attached = false;
let pending: number | null = null;
let lastIdle = -Infinity;

/** Something happened: full rate for the next few seconds. */
export function markActive() {
  last = performance.now();
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  for (const e of ["pointermove", "pointerdown", "wheel", "keydown", "scroll", "touchstart"]) window.addEventListener(e, markActive, { passive: true });
}

/** The frame rate idle loops run at once the page is idle. */
export function setIdleFps(fps: number): void {
  idleFrameMs = 1000 / fps;
}

/** Whether nothing has happened for a while. */
export function idle(now = performance.now()): boolean {
  attach();
  return now - last > IDLE_AFTER_MS;
}

/** Ask for the next frame of an idle loop: now, or on the first display frame an idle frame is due. */
export function ambient(invalidate: () => void): void {
  if (!idle()) {
    invalidate();
    return;
  }
  if (pending !== null) return;
  const tick = (now: number) => {
    // A couple of ms early is due: frames land on the display's grid, not exactly on the interval.
    if (now - lastIdle >= idleFrameMs - 2) {
      pending = null;
      lastIdle = now;
      invalidate();
    } else pending = requestAnimationFrame(tick);
  };
  pending = requestAnimationFrame(tick);
}
