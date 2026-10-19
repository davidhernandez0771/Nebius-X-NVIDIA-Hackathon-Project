// A generative hand overlay: the 21 landmarks drawn as textmode marks, Bayer dither,
// halftone, particles or glowing lines, morphing between them every few seconds and
// whenever the gripper opens or closes, or (trigger "events") only when the caller's cue
// changes. Transparent; sits on top of the webcam view.
//
// Pass the hand either as props (re-render per frame) or, cheaper, as `source`, a
// function the overlay calls once per animation frame.

import { useEffect, useRef, useState } from "react";
import type { HandLandmark } from "../../hand/contracts";
import { FrameMeter } from "./quality";
import { HandArtRenderer } from "./renderer";
import { DEFAULT_CYCLE, type CycleOptions, type HandArtStyle } from "./styleCycle";
import "./handArt.css";

export interface HandArtFrame {
  landmarks: readonly HandLandmark[] | null;
  gripperClosed?: boolean;
  /** Bumped by the caller on each event; with trigger "events", each change morphs the style. */
  cue?: number;
}

export interface HandArtStats {
  /** Animation frames per second. */
  fps: number;
  /** CPU time per frame to step and submit both passes. */
  cpuMeanMs: number;
  cpuP95Ms: number;
  /** GPU time per frame for both passes; null where the browser has no timer queries. */
  gpuMeanMs: number | null;
  gpuP95Ms: number | null;
  width: number;
  height: number;
  styleA: HandArtStyle;
  styleB: HandArtStyle;
  morphing: boolean;
}

export interface HandArtOverlayProps {
  /** 21 raw (unmirrored) MediaPipe landmarks, or null for no hand. Ignored when `source` is set. */
  landmarks?: readonly HandLandmark[] | null;
  gripperClosed?: boolean;
  cue?: number;
  /** Polled once per animation frame; return the latest hand, or null. */
  source?: () => HandArtFrame | null;
  /** A fixed style, or "auto" to cycle. */
  style?: HandArtStyle | "auto";
  /** Flip like a mirror, as Record's view is. Default true. */
  mirrored?: boolean;
  /** Default: the system's prefers-reduced-motion. True shows one static style. */
  reducedMotion?: boolean;
  holdMs?: number;
  morphMs?: number;
  /** "timer" (default): change style every holdMs; "events": change when the cue changes. */
  trigger?: CycleOptions["trigger"];
  cooldownMs?: number;
  /** About twice a second. */
  onStats?: (s: HandArtStats) => void;
  /** true once it draws; false without WebGL, on a lost context, and on unmount. */
  onActiveChange?: (active: boolean) => void;
  className?: string;
}

const STATS_EVERY_MS = 500;
const MAX_DT_MS = 100;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(REDUCED_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(REDUCED_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function HandArtOverlay(props: HandArtOverlayProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState<"starting" | "running" | "unsupported">("starting");

  const systemReduced = useSystemReducedMotion();
  const reducedMotion = props.reducedMotion ?? systemReduced;
  const cycle: CycleOptions = {
    ...DEFAULT_CYCLE,
    holdMs: props.holdMs ?? DEFAULT_CYCLE.holdMs,
    morphMs: props.morphMs ?? DEFAULT_CYCLE.morphMs,
    pinned: props.style && props.style !== "auto" ? props.style : null,
    reducedMotion,
    trigger: props.trigger ?? DEFAULT_CYCLE.trigger,
    cooldownMs: props.cooldownMs ?? DEFAULT_CYCLE.cooldownMs,
  };
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let renderer: HandArtRenderer;
    try {
      renderer = new HandArtRenderer(el, { mirrored: latest.current.mirrored ?? true });
    } catch {
      setState("unsupported"); // no WebGL: Record's own 2D skeleton still shows
      latest.current.onActiveChange?.(false);
      return;
    }
    setState("running");
    latest.current.onActiveChange?.(true);

    const resize = () => renderer.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1);
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(el);

    let raf = 0;
    let last = performance.now();
    let lastStats = last;
    const cpu = new FrameMeter();
    const intervals = new FrameMeter();
    const gpu = new FrameMeter();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(MAX_DT_MS, Math.max(0, now - last));
      last = now;
      const p = latest.current;
      const hand = p.source ? p.source() : { landmarks: p.landmarks ?? null, gripperClosed: p.gripperClosed, cue: p.cue };
      renderer.setMirrored(p.mirrored ?? true);
      renderer.setCycleOptions(cycleRef.current);
      renderer.setHand(hand?.landmarks ?? null, !!hand?.gripperClosed, hand?.cue ?? 0);
      const info = renderer.frame(dt);
      cpu.add(info.cpuMs);
      info.gpuMs.forEach((ms) => gpu.add(ms));
      intervals.add(dt);
      if (p.onStats && now - lastStats >= STATS_EVERY_MS) {
        lastStats = now;
        const c = cpu.stats();
        const iv = intervals.stats();
        const g = gpu.stats();
        p.onStats({
          fps: iv.meanMs > 0 ? 1000 / iv.meanMs : 0,
          cpuMeanMs: c.meanMs,
          cpuP95Ms: c.p95Ms,
          gpuMeanMs: g.count ? g.meanMs : null,
          gpuP95Ms: g.count ? g.p95Ms : null,
          width: info.width,
          height: info.height,
          styleA: info.cycle.a,
          styleB: info.cycle.b,
          morphing: info.cycle.morphing,
        });
      }
    };
    raf = requestAnimationFrame(loop);

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      setState("unsupported");
      latest.current.onActiveChange?.(false);
    };
    el.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      el.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
      latest.current.onActiveChange?.(false);
    };
  }, []);

  if (state === "unsupported") return null;
  return <canvas ref={canvas} className={`hand-art${props.className ? ` ${props.className}` : ""}`} aria-hidden="true" data-state={state} />;
}
