import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { animate, stagger } from "animejs";
import "../three/landing.css";
import { ensureFonts } from "../three/fonts";
import { prefersReducedMotion, shouldRun3D } from "../three/capability";
import { setChapter } from "../three/scrollStore";
import StaticRoom from "../three/StaticRoom";

// Preloaded while the ring fills, so the scene is ready by the time you enter.
const loadScene = () => import("../three/RoomScene");
const RoomScene = lazy(loadScene);

const APP_ROUTE = "/";
const RING_DOTS = 72;
const OUTER_DOTS = 24;
const CAPTIONS = ["LIDAR ONLINE", "RESOLVING SURFACES", "ROOM READY"];

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const ring = (n: number, r: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) };
  });

const INNER = ring(RING_DOTS, 88);
const OUTER = ring(OUTER_DOTS, 98);

type Phase = "loading" | "ready" | "playing";

export default function Entry() {
  const navigate = useNavigate();
  const rm = useMemo(() => prefersReducedMotion(), []);
  const run3d = useMemo(() => shouldRun3D(), []);
  const [phase, setPhase] = useState<Phase>("loading");
  const [caption, setCaption] = useState(0);
  const phaseRef = useRef<Phase>("loading");
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const pct = useRef<HTMLSpanElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);

  const go = () => {
    stop.current?.();
    navigate(APP_ROUTE);
  };

  useEffect(() => {
    ensureFonts();
    const prev = document.title;
    document.title = "SANT";
    return () => {
      document.title = prev;
    };
  }, []);

  // hold the scene on the raw point cloud behind the loader
  useEffect(() => {
    setChapter(0.3);
  }, []);

  // ring loader: fills with real work (scene chunk + fonts), with a floor on time
  useEffect(() => {
    let sceneReady = !run3d;
    let fontsReady = false;
    if (run3d) loadScene().then(() => (sceneReady = true), () => (sceneReady = true));
    Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 2500)),
    ]).then(() => (fontsReady = true));

    const t0 = performance.now();
    const minMs = rm ? 300 : 1700;
    let raf = 0;
    let shown = -1;
    const tick = () => {
      const t = (performance.now() - t0) / minMs;
      const cap = sceneReady && fontsReady ? 1 : 0.9;
      const p = Math.min(cap, t);
      const n = Math.round(p * RING_DOTS);
      if (n !== shown) {
        shown = n;
        dots.current.forEach((d, i) => d && (d.dataset.on = i < n ? "1" : "0"));
        if (pct.current) pct.current.textContent = String(Math.round(p * 100)).padStart(3, "0");
      }
      if (p >= 1) {
        phaseRef.current = "ready";
        setPhase("ready");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run3d, rm]);

  // gentle pulse on the >>> chevrons once ready
  useEffect(() => {
    if (phase !== "ready" || rm) return;
    const a = animate(".enter-chev span", {
      opacity: [0.25, 1, 0.25],
      translateX: [0, 4, 0],
      duration: 1400,
      ease: "inOutSine",
      delay: stagger(160),
      loop: true,
    });
    return () => {
      a.revert();
    };
  }, [phase, rm]);

  // the ~4s decorative sequence
  const play = () => {
    if (phaseRef.current !== "ready") return;
    phaseRef.current = "playing";
    setPhase("playing");

    if (!run3d || rm) {
      const fade = animate(".entry-fade", { opacity: [0, 1], duration: rm ? 200 : 700, ease: "outQuad", onComplete: go });
      stop.current = () => fade.revert();
      return;
    }

    const state = { c: 0.3 };
    const anims = [
      animate(".entry-loader", { opacity: [1, 0], scale: [1, 1.12], duration: 700, ease: "outQuad" }),
      animate(".entry-stage", { opacity: [0.4, 1], duration: 1200, ease: "outQuad" }),
      animate(state, {
        c: 1.9,
        duration: 3400,
        ease: "inOutQuad",
        onUpdate: () => setChapter(state.c),
      }),
      animate(".entry-caption", { opacity: [0, 1], translateY: [10, 0], duration: 600, delay: 500, ease: "outQuad" }),
      animate(".entry-mark", { opacity: [0, 1, 1, 0], scale: [0.94, 1], duration: 1500, delay: 2500, ease: "outExpo" }),
      animate(".entry-fade", { opacity: [0, 1], duration: 600, delay: 3900, ease: "inQuad", onComplete: go }),
    ];
    const timers = [setTimeout(() => setCaption(1), 1200), setTimeout(() => setCaption(2), 2400)];
    stop.current = () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.revert());
    };
  };

  useEffect(() => () => stop.current?.(), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") go();
      else if ((e.key === "Enter" || e.key === " ") && phaseRef.current === "ready") {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="entry" data-phase={phase}>
      <div className="entry-stage" ref={stage} aria-hidden="true">
        {run3d ? (
          <SceneBoundary fallback={<StaticRoom />}>
            <Suspense fallback={null}>
              <RoomScene mode="entry" />
            </Suspense>
          </SceneBoundary>
        ) : (
          <StaticRoom />
        )}
      </div>

      <div className="entry-loader">
        <button
          className="entry-ring"
          onClick={play}
          disabled={phase !== "ready"}
          aria-label={phase === "ready" ? "Enter SANT" : "Loading"}
        >
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <g className="ring-outer">
              {OUTER.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={1.5} />
              ))}
            </g>
            <g className="ring-inner">
              {INNER.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={2} data-on="0" ref={(el) => (dots.current[i] = el)} />
              ))}
            </g>
          </svg>
          <span className="entry-wordmark">SANT</span>
        </button>
        <div className="entry-status" aria-live="polite">
          {phase === "loading" ? (
            <span className="mono-note">
              LOADING <span ref={pct}>000</span>
            </span>
          ) : (
            <button className="enter-chev" onClick={play} disabled={phase !== "ready"}>
              <span>&gt;</span>
              <span>&gt;</span>
              <span>&gt;</span>
              <em>Enter</em>
            </button>
          )}
        </div>
      </div>

      <p className="entry-caption" aria-hidden="true" style={{ opacity: 0 }}>
        <b>{String(caption + 1).padStart(2, "0")}</b> {CAPTIONS[caption]}
      </p>
      <div className="entry-mark" aria-hidden="true" style={{ opacity: 0 }}>SANT</div>
      <div className="entry-fade" style={{ opacity: 0 }} />

      <button className="entry-skip" onClick={go}>
        Skip <span aria-hidden="true">&gt;&gt;</span>
      </button>
    </div>
  );
}
