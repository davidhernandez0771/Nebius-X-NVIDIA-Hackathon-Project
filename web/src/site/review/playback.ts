// The scan's clock: the raw demo plays, glitch-morphs into the perfected one, which plays to its end.
// advance() is pure; usePlayback() drives it with requestAnimationFrame and keeps the live state in a
// ref (the canvas reads it every frame) plus a throttled copy for the DOM (timeline, issue list).

import { useCallback, useEffect, useRef, useState } from "react";

export type Mode = "raw" | "morph" | "perfected";
export interface PlayState {
  mode: Mode;
  t: number; // seconds into the current side's demo (the raw end during the morph)
  morph: number; // 0..1
  playing: boolean;
}
export interface Durations {
  raw: number;
  perfected: number | null;
}

/** Sim seconds per wall second. Shown on the page next to the controls. */
export const SPEED = 2;
export const MORPH_SECONDS = 1.4;

export function advance(s: PlayState, dt: number, d: Durations): PlayState {
  if (!s.playing) return s;
  if (s.mode === "raw") {
    const t = s.t + dt * SPEED;
    if (t < d.raw) return { ...s, t };
    return d.perfected == null ? { ...s, t: d.raw, playing: false } : { ...s, mode: "morph", t: d.raw, morph: 0 };
  }
  if (s.mode === "morph") {
    const morph = s.morph + dt / MORPH_SECONDS;
    return morph < 1 ? { ...s, morph } : { ...s, mode: "perfected", t: 0, morph: 1 };
  }
  const t = s.t + dt * SPEED;
  const end = d.perfected ?? 0;
  return t < end ? { ...s, t } : { ...s, t: end, playing: false };
}

const DOM_EVERY_MS = 80;

export function usePlayback(d: Durations, { autoplay }: { autoplay: boolean }) {
  const ref = useRef<PlayState>({ mode: "raw", t: 0, morph: 0, playing: autoplay });
  const [view, setView] = useState<PlayState>(ref.current);
  const dRef = useRef(d);
  dRef.current = d;

  const publish = useCallback((s: PlayState) => {
    ref.current = s;
    setView(s);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastDom = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const prev = ref.current;
      const next = advance(prev, dt, dRef.current);
      ref.current = next;
      if (next !== prev && (next.mode !== prev.mode || next.playing !== prev.playing || now - lastDom > DOM_EVERY_MS)) {
        lastDom = now;
        setView(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const play = useCallback(() => {
    const s = ref.current;
    const atEnd = s.mode === "perfected" ? s.t >= (dRef.current.perfected ?? 0) : s.mode === "raw" && dRef.current.perfected == null && s.t >= dRef.current.raw;
    publish(atEnd ? { mode: "raw", t: 0, morph: 0, playing: true } : { ...s, playing: true });
  }, [publish]);
  const pause = useCallback(() => publish({ ...ref.current, playing: false }), [publish]);
  const replay = useCallback(() => publish({ mode: "raw", t: 0, morph: 0, playing: true }), [publish]);
  /** Jump to a side and time, paused. The morph is skipped: a jump is the user's choice, shown at once. */
  const seek = useCallback(
    (mode: "raw" | "perfected", t: number) => publish({ mode, t, morph: mode === "perfected" ? 1 : 0, playing: false }),
    [publish],
  );

  return { ref, view, play, pause, replay, seek };
}
