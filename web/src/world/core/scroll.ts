// Moving the page scroll from code: instantly, or as a timed glide (the plug-in's run into the
// projection), which is the user's own scroll in every other respect, so the rail, the handoff and
// Back all work the same.

export function scrollToY(top: number, smooth = false): void {
  try {
    window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  } catch {
    /* jsdom has no scrollTo */
  }
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Glide the scroll to `top` over `ms` (eased). A wheel or key from the user stops it. Returns a cancel. */
export function glideTo(top: number, ms: number): () => void {
  const from = window.scrollY;
  if (ms <= 0 || typeof requestAnimationFrame !== "function") {
    scrollToY(top);
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("keydown", stop);
    window.removeEventListener("touchstart", stop);
  };
  const tick = () => {
    const u = Math.min(1, (performance.now() - t0) / ms);
    scrollToY(from + (top - from) * ease(u));
    if (u < 1) raf = requestAnimationFrame(tick);
    else stop();
  };
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("keydown", stop);
  window.addEventListener("touchstart", stop, { passive: true });
  raf = requestAnimationFrame(tick);
  return stop;
}
