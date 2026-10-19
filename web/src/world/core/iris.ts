// The journey rail's jump, as Active Theory changes floors (docs/design/references/activetheory.md):
// never a fly-through of everything in between. The frame closes to dark from the edges onto a teal
// rim, the scroll and the camera cut to the station while it is shut (store.jump), and it opens from
// the centre on the new view. The same shape as the dive into the workshop (stations/workshop/
// Portal.tsx), drawn in the DOM so it works from any station and over the stills too.

export const IRIS = {
  /** Closing, from fully open to shut. */
  closeMs: 380,
  /** Shut: the cut happens at the start of it, the new view gets a frame to render. */
  holdMs: 90,
  /** Opening on the new station. */
  openMs: 640,
  /** Fully open, in vmax: past the corners of any viewport (half its diagonal is at most ~71). */
  openR: 72,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeIn = (u: number) => u * u * u;
const easeOut = (u: number) => 1 - (1 - u) ** 3;

/** The open radius (vmax) at `ms` into the wipe; 0 while shut. */
export function irisRadius(ms: number): number {
  const { closeMs, holdMs, openMs, openR } = IRIS;
  if (ms < closeMs) return openR * (1 - easeIn(clamp01(ms / closeMs)));
  if (ms < closeMs + holdMs) return 0;
  return openR * easeOut(clamp01((ms - closeMs - holdMs) / openMs));
}

export const IRIS_TOTAL_MS = IRIS.closeMs + IRIS.holdMs + IRIS.openMs;

/**
 * Runs one wipe on `el` (the .world-iris layer): `cut` is called once, when it is shut. A wipe that
 * starts while one runs replaces it (the new cut still happens at its own full cover).
 * Returns a cancel, which also clears the layer.
 */
export function runIris(el: HTMLElement, cut: () => void): () => void {
  const prev = (el as HTMLElement & { _irisStop?: () => void })._irisStop;
  prev?.();
  const t0 = performance.now();
  let raf = 0;
  let cutDone = false;
  const stop = () => {
    cancelAnimationFrame(raf);
    el.classList.remove("is-on");
    el.style.removeProperty("--iris");
  };
  const tick = () => {
    const ms = performance.now() - t0;
    el.style.setProperty("--iris", `${irisRadius(ms).toFixed(2)}vmax`);
    if (!cutDone && ms >= IRIS.closeMs) {
      cutDone = true;
      cut();
    }
    if (ms < IRIS_TOTAL_MS) raf = requestAnimationFrame(tick);
    else stop();
  };
  el.classList.add("is-on");
  tick();
  (el as HTMLElement & { _irisStop?: () => void })._irisStop = stop;
  return stop;
}
