// Where the select HUD locks on. The HUD itself is drawn exactly as in the prototype; on small screens the
// anchor is only nudged so the frame and its title block stay on the stage. All values in canvas pixels.

/** The HUD's radius and frame size for a W × H canvas (the prototype's proportions). */
export function hudFrame(W: number, H: number) {
  const R = Math.min(W, H) * 0.3;
  return { R, fw: R * 1.5, fh: R * 0.95 };
}

/** Clamps the lock-on point (cx, cy) so the frame and the title block above it fit inside the canvas. */
export function hudAnchor(cx: number, cy: number, W: number, H: number, d: number): { cx: number; cy: number } {
  const { fw, fh } = hudFrame(W, H);
  const m = 12 * d;
  const title = 41 * d; // the name line sits 30 px above the frame, plus its cap height
  const fit = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    cx: fit(cx, fw / 2 + m, W - fw / 2 - m),
    cy: fit(cy, fh * 0.55 + title + m, H - fh * 0.45 - m),
  };
}
