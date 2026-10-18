// Canvas fonts for the labels and the HUD. The prototype used Inter / Inter Tight / IBM Plex Mono; the site
// loads Geist and Geist Mono (web/index.html), so the canvases draw with those at the same sizes and weights.
export const SANS = '"Geist", system-ui, sans-serif';
export const HEAVY = '"Geist", system-ui, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, Consolas, monospace';

/** Resolves once the canvas fonts are ready (or right away where the Font Loading API is missing). */
export function fontsReady(): Promise<unknown> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.all([fonts.load(`700 30px ${HEAVY}`), fonts.load(`600 11px ${SANS}`), fonts.load(`500 16px ${MONO}`)]).catch(() => undefined);
}
