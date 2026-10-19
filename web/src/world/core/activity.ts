// Idle loops (the drifting particles, the machine's fans) ask for frames through ambient(): at full
// rate while the visitor is doing something, at 30 fps once nothing has happened for a few seconds.
// A slow drift reads the same at 30 fps, and an idle page then costs the GPU half as much.
const IDLE_AFTER_MS = 3000;
const IDLE_FRAME_MS = 33;

let last = typeof performance !== "undefined" ? performance.now() : 0;
let attached = false;
let pending: ReturnType<typeof setTimeout> | null = null;

function touch() {
  last = performance.now();
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  for (const e of ["pointermove", "pointerdown", "wheel", "keydown", "scroll", "touchstart"]) window.addEventListener(e, touch, { passive: true });
}

/** Whether nothing has happened for a while. */
export function idle(now = performance.now()): boolean {
  attach();
  return now - last > IDLE_AFTER_MS;
}

/** Ask for the next frame of an idle loop: now, or in 33 ms when the page is idle. */
export function ambient(invalidate: () => void): void {
  if (!idle()) {
    invalidate();
    return;
  }
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    invalidate();
  }, IDLE_FRAME_MS);
}
