// The story ↔ app crossing (docs/design/motion.md §4): which pages are story (paper) and which are
// app (volt), which clicks cross between them, and how big each dot-matrix cell of the cover is at
// time t. Pure, so PowerOn.tsx only draws it and the tests need no browser.
import { powerOnPlan } from "./powerOn";

export type SiteMode = "paper" | "volt";
export type ModeOf = (pathname: string) => SiteMode | null;

const PAPER = [/^\/site\/?$/, /^\/site\/results(\/|$)/, /^\/design\/?$/];
const VOLT = [/^\/record\/?$/, /^\/robots(\/|$)/, /^\/review2(\/|$)/, /^\/site\/record-hud(\/|$)/, /^\/design\/app(\/|$)/];

/** The new site's pages by mode; null for every other route (the old app keeps its own look). */
export const siteModeOf: ModeOf = (pathname) => {
  if (PAPER.some((r) => r.test(pathname))) return "paper";
  if (VOLT.some((r) => r.test(pathname))) return "volt";
  return null;
};

type Click = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };
type Anchor = { href: string; target: string; download: boolean };

/**
 * Where a click on a link goes, if it crosses between story and app pages, else null. Only plain
 * left clicks on same-tab, same-origin links count; a new tab or a download is left to the browser.
 */
export function crossingTarget(click: Click, a: Anchor, here: { origin: string; pathname: string }, modeOf: ModeOf): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if ((a.target && a.target !== "_self") || a.download) return null;
  let url: URL;
  try {
    url = new URL(a.href, here.origin);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  const from = modeOf(here.pathname);
  const to = modeOf(url.pathname);
  if (!from || !to || from === to) return null;
  return url.pathname + url.search + url.hash;
}

/** A cover cell: `d` is its distance (0–1) from where the wave starts, `j` a fixed jitter (0–1). */
export type CellWave = { d: number; j: number };

const plan = powerOnPlan(false);
const COVER = plan.find((s) => s.phase === "cover");
const REVEAL = plan.find((s) => s.phase === "reveal");
const COVER_END = COVER?.phase === "cover" ? COVER.at + COVER.duration : 340;
const REVEAL_AT = REVEAL?.at ?? 560;
const REVEAL_END = REVEAL?.phase === "reveal" ? REVEAL.at + REVEAL.duration : 860;

const GROW = 160;
const JITTER = 30;
const outCubic = (u: number) => 1 - (1 - u) ** 3;
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/**
 * How full a cell is at time t (0 empty, 1 a solid square): it grows in a wave from the click
 * (`cover`), stays full while the route changes, then shrinks in a wave from the centre (`reveal`).
 */
export function coverAt(t: number, cover: CellWave, reveal: CellWave): number {
  if (t < REVEAL_AT) {
    const wave = COVER_END - GROW - JITTER;
    const start = cover.d * wave + cover.j * JITTER;
    return outCubic(clamp01((t - start) / GROW));
  }
  const wave = REVEAL_END - REVEAL_AT - GROW - JITTER;
  const start = REVEAL_AT + reveal.d * wave + reveal.j * JITTER;
  return 1 - outCubic(clamp01((t - start) / GROW));
}
