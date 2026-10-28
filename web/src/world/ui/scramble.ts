// The glitch reveal from the prototype (docs/design/prototypes/site-journey.html): letters settle
// left to right out of a run of slash glyphs. With reduced motion the text is set at once.

export const GLYPHS = "/\\|<>_=+*#01SANT";

/** The text `k` (0–1) of the way through the reveal. Spaces stay spaces, so words keep their shape. */
export function scrambleText(final: string, k: number, rnd: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < final.length; i++) {
    const ch = final[i];
    out += ch === " " || k >= 1 || i / final.length < k * 1.2 - 0.2 ? ch : GLYPHS[Math.floor(rnd() * GLYPHS.length)];
  }
  return out;
}

const running = new WeakMap<Element, number>();

/** Plays the reveal on an element's text. Returns a cancel that leaves the final text in place. */
export function scramble(el: HTMLElement, final: string, { duration = 650, reduced = false } = {}): () => void {
  const stop = () => {
    const raf = running.get(el);
    if (raf !== undefined) cancelAnimationFrame(raf);
    running.delete(el);
    el.textContent = final;
  };
  const prev = running.get(el);
  if (prev !== undefined) cancelAnimationFrame(prev);
  if (reduced || typeof requestAnimationFrame !== "function") {
    el.textContent = final;
    return stop;
  }
  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / duration);
    el.textContent = scrambleText(final, k);
    if (k < 1) running.set(el, requestAnimationFrame(tick));
    else running.delete(el);
  };
  tick();
  return stop;
}
