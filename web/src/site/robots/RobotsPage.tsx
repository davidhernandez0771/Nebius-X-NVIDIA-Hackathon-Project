// My robots (/robots): the shelf from docs/design/prototypes/robot-shelf.html, in production React.
// WebGL + full motion → the 3D spiral with the select HUD. Reduced motion, effects off or no WebGL → a flat shelf.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Vector2 } from "three";
import { useMotion } from "../../sant/motion/MotionProvider";
import { COPIES, ROBOTS } from "./robots";
import { Hud } from "./hud";
import { fontsReady } from "./fonts";
import { FlatShelf } from "./FlatShelf";
import type { ShelfView } from "./ShelfScene";
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

const DPR_CAP = 1.75;

export function RobotsPage() {
  const { reduced } = useMotion();
  const [webgl] = useState(hasWebGL);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const hudCanvas = useRef<HTMLCanvasElement>(null);
  const hud = useRef<Hud | null>(null);
  const view = useRef<ShelfView>({ selected: null, reduce: reduced, ptr: new Vector2(), scrollT: 0.5 });
  const three = webgl && !reduced;

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
  useEffect(() => {
    const el = stage.current;
    if (!three || !el) return;
    let dragY: number | null = null;
    const nudge = (dy: number) => {
      view.current.scrollT = Math.min(1, Math.max(0, view.current.scrollT + dy * 0.0006));
      setSelected(null);
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

  const onHover = useCallback((on: boolean) => { if (stage.current) stage.current.style.cursor = on ? "pointer" : ""; }, []);
  const sel = selected == null ? null : ROBOTS[selected];

  return (
    <div className="robots-page" data-mode="volt">
      <div className={`robots-stage${three ? "" : " robots-stage--flat"}`} ref={stage}>
        {three && ready && (
          <Suspense fallback={null}>
            <ShelfScene view={view} hud={hud} onPick={(i) => pick(i)} onMiss={() => setSelected(null)} onHover={onHover} />
          </Suspense>
        )}
        {three && <canvas className="robots-hud" ref={hudCanvas} aria-hidden="true" />}
        {!three && <FlatShelf selected={selected} onPick={pick} />}
        <div className="robots-top">
          <span className="robots-mark">SANT</span>
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
