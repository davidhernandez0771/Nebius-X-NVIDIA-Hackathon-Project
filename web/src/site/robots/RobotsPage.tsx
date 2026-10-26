// My robots (/robots): the shelf from docs/design/prototypes/robot-shelf.html, in production React.
// WebGL + full motion → the 3D spiral with the select HUD. Reduced motion, effects off or no WebGL → a flat shelf.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BackToWorkshop } from "../../sant/components/BackToWorkshop";
import { Logo } from "../../sant/components/Logo";
import { Vector2 } from "three";
import { useMotion } from "../../sant/motion/MotionProvider";
import { COPIES, ROBOTS } from "./robots";
import { Hud } from "./hud";
import { fontsReady } from "./fonts";
import { FlatShelf } from "./FlatShelf";
import type { ShelfView } from "./ShelfScene";
import { PerfProbe, readPerfConfig } from "./perf";
import { PerfOverlay } from "./PerfOverlay";
import "./robots.css";

const ShelfScene = lazy(() => import("./ShelfScene"));

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const DPR_CAP = 1.5;

export function RobotsPage() {
  const { reduced } = useMotion();
  const [webgl] = useState(hasWebGL);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const hudCanvas = useRef<HTMLCanvasElement>(null);
  const hud = useRef<Hud | null>(null);
  const view = useRef<ShelfView>({ selected: null, reduce: reduced, ptr: new Vector2(), scrollT: 0.5, wheel: 0 });
  const [active, setActive] = useState(true);
  const three = webgl && !reduced;
  const [perfCfg] = useState(() => readPerfConfig(typeof location !== "undefined" ? location.search : ""));
  const [probe] = useState(() => {
    if (!perfCfg.on) return null;
    const p = new PerfProbe();
    if (perfCfg.sync) p.meta.sync = 1;
    return p;
  });

  // Labels and the HUD draw text into canvases, so wait for the fonts first (as the prototype did).
  useEffect(() => {
    let live = true;
    fontsReady().then(() => live && setReady(true));
    return () => { live = false; };
  }, []);

  const pick = useCallback((i: number | null) => setSelected((cur) => (i === null || cur === i ? null : i)), []);

  useEffect(() => {
    view.current.selected = selected;
    hud.current?.select(selected == null ? null : ROBOTS[selected], selected ?? 0, performance.now());
  }, [selected]);

  useEffect(() => {
    view.current.reduce = reduced;
    hud.current?.setReduce(reduced);
  }, [reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // HUD canvas, sized to the stage at the capped DPR.
  useEffect(() => {
    const el = stage.current, c = hudCanvas.current;
    if (!three || !ready || !el || !c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    hud.current = new Hud(c, dpr, view.current.reduce);
    const fit = () => hud.current?.resize(el.clientWidth, el.clientHeight, Math.min(window.devicePixelRatio || 1, DPR_CAP));
    fit();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    if (view.current.selected != null) hud.current.select(ROBOTS[view.current.selected], view.current.selected, performance.now());
    return () => { ro?.disconnect(); hud.current = null; };
  }, [three, ready]);

  // Scroll moves through the pile (and drops the pick); the pointer adds a little parallax; touch drags scroll.
  // Input is only gathered here; the frame loop applies it once per frame, however many events arrive.
  useEffect(() => {
    const el = stage.current;
    if (!three || !el) return;
    let dragY: number | null = null;
    const nudge = (dy: number) => {
      view.current.wheel += dy;
      if (view.current.selected != null) setSelected(null);
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); nudge(e.deltaY); };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      view.current.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
      if (e.pointerType === "touch" && dragY != null) { nudge((dragY - e.clientY) * 3); dragY = e.clientY; }
    };
    const onDown = (e: PointerEvent) => { if (e.pointerType === "touch") dragY = e.clientY; };
    const onUp = () => { dragY = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [three]);

  // Stop rendering while the tab is hidden or the stage is scrolled off-screen.
  useEffect(() => {
    const el = stage.current;
    if (!three || !el) return;
    let visible = true, onScreen = true;
    const update = () => setActive(visible && onScreen);
    const onVis = () => { visible = document.visibilityState !== "hidden"; update(); };
    document.addEventListener("visibilitychange", onVis);
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; update(); }) : null;
    io?.observe(el);
    onVis();
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
  }, [three]);

  useEffect(() => {
    if (!probe || typeof PerformanceObserver === "undefined") return;
    try {
      const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => probe.longTask(e.duration)));
      po.observe({ type: "longtask", buffered: false });
      return () => po.disconnect();
    } catch {
      return; // longtask entries are Chromium-only
    }
  }, [probe]);

  // ?perf&sweep: scroll the whole pile twice with synthetic wheel events (cold pass, then warm pass), resetting
  // the probe at each pass and leaving both summaries on window.__perfResult.
  useEffect(() => {
    const el = stage.current;
    if (!three || !ready || !probe || !perfCfg.sweep || !el) return;
    const results: Record<string, unknown> = {};
    (window as unknown as { __perfResult?: unknown }).__perfResult = results;
    const STEP = 8, HZ = 60, PASS_EVENTS = Math.round(2 / (STEP * 0.0006)); // one pass ≈ the pile up and down
    let n = 0, pass = 0, dir = 1;
    view.current.scrollT = 0;
    view.current.wheel = 0;
    probe.reset();
    const id = window.setInterval(() => {
      if (view.current.scrollT >= 1) dir = -1;
      else if (view.current.scrollT <= 0) dir = 1;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * STEP, bubbles: true, cancelable: true }));
      if (++n % PASS_EVENTS === 0) {
        results[pass === 0 ? "cold" : "warm"] = { ...probe.summary(), hitchLog: probe.hitches.slice(0, 20) };
        probe.reset();
        if (++pass === 2) window.clearInterval(id);
      }
    }, 1000 / HZ);
    return () => window.clearInterval(id);
  }, [three, ready, probe, perfCfg.sweep]);

  const onHover = useCallback((on: boolean) => { if (stage.current) stage.current.style.cursor = on ? "pointer" : ""; }, []);
  const sel = selected == null ? null : ROBOTS[selected];

  return (
    <div className="robots-page" data-mode="volt">
      <div className={`robots-stage${three ? "" : " robots-stage--flat"}`} ref={stage}>
        {three && ready && (
          <Suspense fallback={null}>
            <ShelfScene view={view} hud={hud} onPick={(i) => pick(i)} onMiss={() => setSelected(null)} onHover={onHover} perf={probe} dpr={perfCfg.dpr} tier={perfCfg.tier} active={active} />
          </Suspense>
        )}
        {three && <canvas className="robots-hud" ref={hudCanvas} aria-hidden="true" />}
        {three && probe && <PerfOverlay probe={probe} />}
        {!three && <FlatShelf selected={selected} onPick={pick} />}
        <div className="robots-top">
          <span className="robots-top__left">
            <span className="robots-mark">
              <Logo size="sm" lit="all" />
            </span>
            <BackToWorkshop className="robots-back" />
          </span>
          <span>robots@sant · copies {COPIES.verified}/{COPIES.total} verified</span>
        </div>
        <nav className="robots-list" aria-label="Robots">
          {ROBOTS.map((r, i) => (
            <button key={r.id} type="button" aria-current={selected === i ? "true" : "false"} onClick={() => pick(i)}>
              {r.name}
              <em>
                {r.status}, {r.year}
              </em>
            </button>
          ))}
        </nav>
        <p className="robots-blurb">
          SANT turns one webcam demo into physics-verified robot data.
          <br />
          Every cartridge here is a robot or one of its verified copies.
        </p>
        <div className="robots-hint">{three ? "scroll · click · esc" : "click · esc"}</div>
        <p className="robots-sr" aria-live="polite">
          {sel ? `${sel.name}: ${sel.status}, ${sel.note}. ${sel.sub.toLowerCase()}.` : ""}
        </p>
      </div>
    </div>
  );
}

export default RobotsPage;
