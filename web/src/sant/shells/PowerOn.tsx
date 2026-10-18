// The story → app "power on" (docs/design/motion.md §4): a Volt cover grows from the clicked
// button, specks of dust drift in the dark and gather into the logo symbol one part at a time,
// each unit lights as its dust lands, the route changes while the page is covered, and the cover
// fades to reveal the app. Reduced motion or Effects off: an instant route change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { dustPoint, makeDust, sampleMask, type DustTiming, type Pt } from "../motion/dust";
import { LOGO_SYMBOL } from "../components/logoSymbol";
import { useMotion } from "../motion/MotionProvider";
import { powerOnPlan, type PowerOnStep } from "../motion/powerOn";

type Run = { id: number; x: number; y: number; phase: "start" | "cover" | "reveal"; lit: number; dust: "on" | "off" };

/** The plan lights four steps (S → A → N → T); a symbol with another number of parts spreads over them. */
const STEPS = 4;
const stepOf = (part: number) => Math.floor((part * STEPS) / LOGO_SYMBOL.units.length);
const DUST_FADE = 200;
const MAX_SPECKS = 900;

const PowerOnContext = createContext<{ start: (to: string, from?: Element | null) => void }>({ start: () => {} });

function focusPageHeading() {
  const h = document.querySelector<HTMLElement>("main h1");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus();
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
  ctx.fill(new Path2D(d));
  const step = Math.max(2, Math.round(w / 64));
  return sampleMask(ctx.getImageData(0, 0, w, h), step).map((p) => ({ x: rect.left + p.x, y: rect.top + p.y }));
}

/** Draws the dust for one run; returns a cleanup. Returns null when there is no 2D canvas. */
function playDust(canvas: HTMLCanvasElement, overlay: HTMLElement, startedAt: number, timing: DustTiming): (() => void) | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);

  const svg = overlay.querySelector<SVGSVGElement>(".sant-poweron__mark");
  if (!svg) return null;
  // One target list per lighting step, so each step's dust lands as that step lights.
  let targets: Pt[][] = Array.from({ length: STEPS }, () => []);
  LOGO_SYMBOL.units.forEach((d, i) => targets[stepOf(i)].push(...partPoints(svg, d)));
  const total = targets.reduce((n, t) => n + t.length, 0);
  if (total > MAX_SPECKS) {
    const keep = MAX_SPECKS / total;
    targets = targets.map((t) => t.filter((_, i) => Math.floor(i * keep) !== Math.floor((i + 1) * keep) || i === 0));
  }
  const dust = makeDust(targets, { width, height, seed: startedAt & 0xffff });
  const style = getComputedStyle(overlay);
  const ink = style.getPropertyValue("--sant-text").trim() || "#E6EDF3";
  const accent = style.getPropertyValue("--sant-accent").trim() || "#19F5C2";
  const end = timing.at + timing.duration + (targets.length - 1) * timing.stagger + timing.fade;

  let frame = requestAnimationFrame(function draw(now) {
    const t = now - startedAt;
    ctx.clearRect(0, 0, width, height);
    for (const p of dust) {
      const at = dustPoint(p, t, timing);
      if (at.alpha <= 0) continue;
      ctx.globalAlpha = at.alpha;
      // A speck turns teal as it settles into its letter.
      ctx.fillStyle = at.alpha > 0.9 ? accent : ink;
      ctx.fillRect(at.x, at.y, 1.6, 1.6);
    }
    if (t < end) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, width, height);
  });
  return () => cancelAnimationFrame(frame);
}

export function PowerOnProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { reduced } = useMotion();
  const [run, setRun] = useState<Run | null>(null);
  const timers = useRef<number[]>([]);
  const pending = useRef<{ to: string; navigated: boolean; startedAt: number } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const finish = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const p = pending.current;
    pending.current = null;
    if (p && !p.navigated) navigate(p.to);
    setRun(null);
    window.setTimeout(focusPageHeading, 0);
  }, [navigate]);

  const apply = useCallback(
    (step: PowerOnStep) => {
      switch (step.phase) {
        case "cover":
          setRun((r) => r && { ...r, phase: "cover" });
          break;
        case "gather":
          // The canvas follows the clock itself (playDust); the plan only says when.
          break;
        case "light":
          setRun((r) => r && { ...r, lit: step.unit + 1 });
          break;
        case "navigate":
          if (pending.current) {
            pending.current.navigated = true;
            navigate(pending.current.to);
          }
          break;
        case "reveal":
          setRun((r) => r && { ...r, phase: "reveal" });
          break;
        case "done":
          finish();
          break;
      }
    },
    [navigate, finish],
  );

  const start = useCallback(
    (to: string, from?: Element | null) => {
      if (pending.current) {
        finish();
        return;
      }
      if (reduced) {
        navigate(to);
        window.setTimeout(focusPageHeading, 0);
        return;
      }
      const rect = from?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const startedAt = performance.now();
      pending.current = { to, navigated: false, startedAt };
      setRun({ id: startedAt, x, y, phase: "start", lit: 0, dust: "on" });
      // The cover step at t = 0 still runs in a timer, so the first frame paints the circle at 0.
      timers.current = powerOnPlan(false).map((step) => window.setTimeout(() => apply(step), step.at));
    },
    [reduced, navigate, finish, apply],
  );

  const runId = run?.id;
  useEffect(() => {
    if (runId === undefined || !canvas.current || !overlay.current || !pending.current) return;
    const gather = powerOnPlan(false).find((s) => s.phase === "gather");
    if (gather?.phase !== "gather") return;
    const stop = playDust(canvas.current, overlay.current, pending.current.startedAt, { ...gather, fade: DUST_FADE });
    if (!stop) {
      setRun((r) => r && { ...r, dust: "off" });
      return;
    }
    return stop;
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
            data-mode="volt"
            data-phase={run.phase}
            data-dust={run.dust}
            aria-hidden="true"
            onClick={finish}
            style={{ "--x": `${run.x}px`, "--y": `${run.y}px` } as CSSProperties}
          >
            <canvas ref={canvas} className="sant-poweron__dust" />
            <svg className="sant-poweron__mark" viewBox={LOGO_SYMBOL.viewBox} focusable="false">
              {LOGO_SYMBOL.units.map((d, i) => (
                <path key={i} className="sant-poweron__unit" d={d} data-part={i === 0 ? "original" : "copy"} data-lit={stepOf(i) < run.lit} />
              ))}
            </svg>
          </div>,
          document.body,
        )}
    </PowerOnContext.Provider>
  );
}

export function usePowerOn() {
  return useContext(PowerOnContext);
}
