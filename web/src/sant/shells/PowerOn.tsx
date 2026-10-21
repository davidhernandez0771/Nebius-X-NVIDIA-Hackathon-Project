// The story ↔ app crossing, "power on" (docs/design/motion.md §4). Whenever a navigation crosses
// between the paper story pages and the volt app pages, in either direction:
//   1. the page dissolves into a dot matrix of the other mode's colour, in a wave from the click;
//   2. the route changes under the full cover while specks of dust gather into the logo symbol,
//      each part lighting as its dust lands;
//   3. the cover powers off into shrinking dots and the new page is there. Where the browser has
//      the View Transitions API this last step is a CSS dot mask on the old snapshot; elsewhere the
//      canvas shrinks the dots itself.
// Links that cross are caught here, so pages need nothing special; back/forward and code that calls
// navigate() get the second half. Everything is a 2D canvas or CSS (no WebGL), about 3,000 rects a
// frame. Reduced motion or Effects off: a quick crossfade (a view transition, or a fade from the new
// page's colour).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { LOGO_SYMBOL } from "../components/logoSymbol";
import { coverAt, crossingTarget, siteModeOf, type CellWave, type ModeOf, type SiteMode } from "../motion/crossing";
import { dustPoint, makeDust, sampleMask, seeded, type DustTiming, type Pt } from "../motion/dust";
import { useMotion } from "../motion/MotionProvider";
import { powerOnPlan, type PowerOnStep } from "../motion/powerOn";
import { DURATIONS } from "../motion/tokens";

type Run = { id: number; x: number; y: number; phase: "start" | "cover" | "reveal"; lit: number; dust: "on" | "off"; mode: SiteMode };
type Pending = { to: string; navigated: boolean; startedAt: number; outside: boolean };
type TransitionDoc = { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } };

const DUST_FADE = 200;
const MAX_SPECKS = 900;
const CELL = 18;
const PLAN = powerOnPlan(false);
const REVEAL_AT = PLAN.find((s) => s.phase === "reveal")?.at ?? 560;
/** Where a crossing we didn't start (back/forward) picks up: fully covered, just before the reveal. */
const ARRIVE_FROM = REVEAL_AT - 100;

/** The plan lights four steps (S → A → N → T); a symbol with another number of parts spreads over them. */
const STEPS = 4;
const stepOf = (part: number) => Math.floor((part * STEPS) / LOGO_SYMBOL.units.length);

const PowerOnContext = createContext<{ start: (to: string, from?: Element | null) => void }>({ start: () => {} });

function focusPageHeading() {
  const h = document.querySelector<HTMLElement>("main h1");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus();
}

function transitionDoc(): TransitionDoc {
  return document as unknown as TransitionDoc;
}

/** The points of one symbol part, drawn off-screen at the size and place the symbol has on screen. */
function partPoints(svg: SVGSVGElement, d: string): Pt[] {
  const rect = svg.getBoundingClientRect();
  const w = Math.ceil(rect.width);
  const h = Math.ceil(rect.height);
  if (w === 0 || h === 0 || typeof Path2D !== "function") return [];
  const [vx, vy, vw, vh] = LOGO_SYMBOL.viewBox.split(/[\s,]+/).map(Number);
  // preserveAspectRatio's default: scale to fit, centred.
  const k = Math.min(w / vw, h / vh);
  const ox = (w - vw * k) / 2 - vx * k;
  const oy = (h - vh * k) / 2 - vy * k;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) return [];
  ctx.setTransform(k, 0, 0, k, ox, oy);
  // The mark is strokes (logoSymbol.ts): the dust lands on the lines as they are drawn.
  if (LOGO_SYMBOL.stroke > 0) {
    ctx.lineWidth = LOGO_SYMBOL.stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(new Path2D(d));
  } else ctx.fill(new Path2D(d));
  const step = Math.max(2, Math.round(w / 64));
  return sampleMask(ctx.getImageData(0, 0, w, h), step).map((p) => ({ x: rect.left + p.x, y: rect.top + p.y }));
}

/** Draws one crossing: the dot-matrix cover and the dust. Returns a cleanup, or null without a 2D canvas. */
function playCrossing(canvas: HTMLCanvasElement, overlay: HTMLElement, origin: Pt, startedAt: number, timing: DustTiming): (() => void) | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);

  // The cover's cells: a wave out from the click, then a wave out from the centre.
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const rnd = seeded(startedAt & 0xffff);
  const far = Math.max(Math.hypot(origin.x, origin.y), Math.hypot(width - origin.x, origin.y), Math.hypot(origin.x, height - origin.y), Math.hypot(width - origin.x, height - origin.y)) || 1;
  const mid = Math.hypot(width / 2, height / 2) || 1;
  const cover: CellWave[] = [];
  const reveal: CellWave[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      const j = rnd();
      cover.push({ d: Math.hypot(x - origin.x, y - origin.y) / far, j });
      reveal.push({ d: Math.hypot(x - width / 2, y - height / 2) / mid, j: 1 - j });
    }
  }

  let targets: Pt[][] = Array.from({ length: STEPS }, () => []);
  const svg = overlay.querySelector<SVGSVGElement>(".sant-poweron__mark");
  if (svg) LOGO_SYMBOL.units.forEach((d, i) => targets[stepOf(i)].push(...partPoints(svg, d)));
  const total = targets.reduce((n, t) => n + t.length, 0);
  if (total > MAX_SPECKS) {
    const keep = MAX_SPECKS / total;
    targets = targets.map((t) => t.filter((_, i) => Math.floor(i * keep) !== Math.floor((i + 1) * keep) || i === 0));
  }
  const dust = makeDust(targets, { width, height, seed: startedAt & 0xffff });
  const style = getComputedStyle(overlay);
  const bg = style.getPropertyValue("--sant-bg").trim() || "#07090C";
  const ink = style.getPropertyValue("--sant-text").trim() || "#E6EDF3";
  const accent = style.getPropertyValue("--sant-accent").trim() || "#19F5C2";
  const end = DURATIONS.power + 20;

  let frame = requestAnimationFrame(function draw(now) {
    const t = now - startedAt;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bg;
    if (t >= REVEAL_AT - 220 && t < REVEAL_AT) {
      ctx.fillRect(0, 0, width, height);
    } else {
      for (let i = 0; i < cover.length; i++) {
        const s = coverAt(t, cover[i], reveal[i]);
        if (s <= 0) continue;
        const x = (i % cols) * CELL;
        const y = Math.floor(i / cols) * CELL;
        if (s >= 0.999) ctx.fillRect(x, y, CELL + 0.5, CELL + 0.5);
        else {
          const side = CELL * s;
          ctx.fillRect(x + (CELL - side) / 2, y + (CELL - side) / 2, side, side);
        }
      }
    }
    // The dust fades with the cover once the reveal starts.
    const fade = t < REVEAL_AT ? 1 : Math.max(0, 1 - (t - REVEAL_AT) / 160);
    if (fade > 0) {
      for (const p of dust) {
        const at = dustPoint(p, t, timing);
        if (at.alpha <= 0) continue;
        ctx.globalAlpha = at.alpha * fade;
        // A speck turns to the accent as it settles into its part.
        ctx.fillStyle = at.alpha > 0.9 ? accent : ink;
        ctx.fillRect(at.x, at.y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
    if (t < end) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, width, height);
  });
  return () => cancelAnimationFrame(frame);
}

export function PowerOnProvider({ children, modeOf = siteModeOf }: { children: ReactNode; modeOf?: ModeOf }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { reduced } = useMotion();
  const [run, setRun] = useState<Run | null>(null);
  const [fade, setFade] = useState<{ id: number; mode: SiteMode } | null>(null);
  const timers = useRef<number[]>([]);
  const pending = useRef<Pending | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const here = useRef(location.pathname);
  here.current = location.pathname;
  // The path of a navigation this provider made itself, so the arrival effect doesn't replay it.
  const ours = useRef<string | null>(null);

  const go = useCallback(
    (to: string) => {
      if (pending.current) pending.current.navigated = true;
      ours.current = to.split(/[?#]/)[0];
      navigate(to);
      window.scrollTo?.(0, 0);
    },
    [navigate],
  );

  const finish = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const p = pending.current;
    if (p && !p.navigated) go(p.to);
    pending.current = null;
    setRun(null);
    window.setTimeout(focusPageHeading, 0);
  }, [go]);

  /** The reveal as a view transition: the covered screen is the old snapshot and dissolves in a dot mask. */
  const revealWithViewTransition = useCallback((): boolean => {
    const doc = transitionDoc();
    if (typeof doc.startViewTransition !== "function") return false;
    const root = document.documentElement;
    root.dataset.crossing = "reveal";
    try {
      const vt = doc.startViewTransition(() => flushSync(() => setRun(null)));
      void vt.finished.finally(() => delete root.dataset.crossing);
      return true;
    } catch {
      delete root.dataset.crossing;
      return false;
    }
  }, []);

  const apply = useCallback(
    (step: PowerOnStep) => {
      const p = pending.current;
      switch (step.phase) {
        case "cover":
          setRun((r) => r && { ...r, phase: "cover" });
          break;
        case "gather":
          // The canvas follows the clock itself (playCrossing); the plan only says when.
          break;
        case "light":
          setRun((r) => r && { ...r, lit: step.unit + 1 });
          break;
        case "navigate":
          // A page outside the new site (e.g. /pm/record) unmounts this provider, so it waits for the end.
          if (p && !p.outside && !p.navigated) go(p.to);
          break;
        case "reveal":
          if (p?.outside) break;
          if (!revealWithViewTransition()) setRun((r) => r && { ...r, phase: "reveal" });
          break;
        case "done":
          finish();
          break;
      }
    },
    [go, finish, revealWithViewTransition],
  );

  /** Reduced motion: a quick crossfade, as a view transition or a fade from the new page's colour. */
  const crossfade = useCallback(
    (to: string, mode: SiteMode) => {
      const doc = transitionDoc();
      const root = document.documentElement;
      if (typeof doc.startViewTransition === "function") {
        root.dataset.crossing = "fade";
        try {
          const vt = doc.startViewTransition(() => flushSync(() => go(to)));
          void vt.finished.finally(() => delete root.dataset.crossing);
        } catch {
          delete root.dataset.crossing;
          go(to);
        }
      } else {
        go(to);
        const id = performance.now();
        setFade({ id, mode });
        // In case animationend never comes (e.g. a background tab), the fade can't stay up.
        window.setTimeout(() => setFade((f) => (f?.id === id ? null : f)), 400);
      }
      window.setTimeout(focusPageHeading, 0);
    },
    [go],
  );

  const start = useCallback(
    (to: string, from?: Element | null) => {
      if (pending.current) {
        finish();
        return;
      }
      const target = modeOf(to.split(/[?#]/)[0]);
      // start() without a known target is the story → app power-on (e.g. into /pm/record).
      const mode: SiteMode = target ?? (modeOf(here.current) === "volt" ? "paper" : "volt");
      if (reduced) {
        crossfade(to, mode);
        return;
      }
      const rect = from?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const startedAt = performance.now();
      pending.current = { to, navigated: false, startedAt, outside: target === null };
      setRun({ id: startedAt, x, y, phase: "start", lit: 0, dust: "on", mode });
      // The cover step at t = 0 still runs in a timer, so the first frame paints the cover at 0.
      timers.current = PLAN.map((step) => window.setTimeout(() => apply(step), step.at));
    },
    [reduced, modeOf, finish, apply, crossfade],
  );

  const startRef = useRef(start);
  startRef.current = start;

  // Any link that crosses between story and app pages plays the crossing.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const to = crossingTarget(e, { href: a.href, target: a.target, download: a.hasAttribute("download") }, { origin: window.location.origin, pathname: here.current }, modeOf);
      if (!to) return;
      e.preventDefault();
      startRef.current(to, a);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [modeOf]);

  // A crossing this provider didn't start (back/forward, or code calling navigate): play the second
  // half, from full cover. A layout effect, so the new page never shows uncovered first.
  const lastMode = useRef(modeOf(location.pathname));
  useLayoutEffect(() => {
    const mode = modeOf(location.pathname);
    const prev = lastMode.current;
    lastMode.current = mode;
    const mine = ours.current === location.pathname;
    ours.current = null;
    if (mine || pending.current || !prev || !mode || prev === mode || reduced) return;
    const startedAt = performance.now() - ARRIVE_FROM;
    pending.current = { to: location.pathname, navigated: true, startedAt, outside: false };
    setRun({ id: startedAt, x: window.innerWidth / 2, y: window.innerHeight / 2, phase: "cover", lit: STEPS, dust: "on", mode });
    timers.current = PLAN.filter((s) => s.at > ARRIVE_FROM && (s.phase === "reveal" || s.phase === "done")).map((s) =>
      window.setTimeout(() => apply(s), s.at - ARRIVE_FROM),
    );
  }, [location.pathname, modeOf, reduced, apply]);

  const runId = run?.id;
  useEffect(() => {
    if (runId === undefined || !canvas.current || !overlay.current || !pending.current || !run) return;
    const gather = PLAN.find((s) => s.phase === "gather");
    if (gather?.phase !== "gather") return;
    const stop = playCrossing(canvas.current, overlay.current, { x: run.x, y: run.y }, pending.current.startedAt, { ...gather, fade: DUST_FADE });
    if (!stop) {
      setRun((r) => r && { ...r, dust: "off" });
      return;
    }
    return stop;
    // Only a new run restarts the drawing; its phase changes don't.
  }, [runId]);

  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, finish]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const value = useMemo(() => ({ start }), [start]);
  return (
    <PowerOnContext.Provider value={value}>
      {children}
      {run &&
        createPortal(
          <div
            ref={overlay}
            className="sant sant-poweron"
            data-mode={run.mode}
            data-phase={run.phase}
            data-dust={run.dust}
            aria-hidden="true"
            onClick={finish}
            style={{ "--x": `${run.x}px`, "--y": `${run.y}px` } as CSSProperties}
          >
            <canvas ref={canvas} className="sant-poweron__dust" />
            <svg
              className="sant-poweron__mark"
              viewBox={LOGO_SYMBOL.viewBox}
              focusable="false"
              fill={LOGO_SYMBOL.stroke > 0 ? "none" : undefined}
              strokeWidth={LOGO_SYMBOL.stroke || undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {LOGO_SYMBOL.units.map((d, i) => (
                <path key={i} className="sant-poweron__unit" d={d} data-part={LOGO_SYMBOL.accent.includes(i) ? "accent" : "ink"} data-lit={stepOf(i) < run.lit} />
              ))}
            </svg>
          </div>,
          document.body,
        )}
      {fade &&
        createPortal(
          <div key={fade.id} className="sant sant-crossfade" data-mode={fade.mode} aria-hidden="true" onAnimationEnd={() => setFade(null)} />,
          document.body,
        )}
    </PowerOnContext.Provider>
  );
}

export function usePowerOn() {
  return useContext(PowerOnContext);
}
