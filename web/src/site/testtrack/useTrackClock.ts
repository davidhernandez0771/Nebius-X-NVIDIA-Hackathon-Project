// The replay clock the test track and the LOOK clip share: a looping time in seconds at `speed`, over a run plus a
// hold at its end, that a scrubber or a key can set.
import { useCallback, useEffect, useRef, useState } from "react";
import { advance, END_HOLD_S } from "./model";

/** A looping clock at `speed`, ticking at most 30 times a second while playing. */
export function useTrackClock(duration: number, playing: boolean, speed: number, hold: number = END_HOLD_S): [number, (t: number) => void] {
  const [t, setT] = useState(0);
  const now = useRef(0);
  useEffect(() => {
    if (!playing || duration <= 0) return;
    let raf = 0;
    let last: number | null = null;
    let shown = 0;
    const tick = (ms: number) => {
      now.current = advance(now.current, last === null ? 0 : (ms - last) / 1000, speed, duration, hold);
      last = ms;
      if (ms - shown >= 1000 / 30 - 1) {
        shown = ms;
        setT(now.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, speed, hold]);
  const seek = useCallback(
    (v: number) => {
      now.current = Math.max(0, Math.min(duration, v));
      setT(now.current);
    },
    [duration],
  );
  return [t, seek];
}
