import { useEffect, useRef, useState, type CSSProperties } from "react";
import { digitDots } from "../motion/countdown";
import { useMotion } from "../motion/MotionProvider";

const RING = 24;

/**
 * The 3-2-1 before recording starts: a dot-matrix digit inside a ring of dots that empties over
 * each second. The timing is the point, so it keeps counting with reduced motion; only the
 * ring's emptying and the dots' fade stop. `onDone` runs once, a second after 1.
 */
export function DottedCountdown({
  from = 3,
  running,
  onDone,
  interval = 1000,
  label = "Recording starts in",
}: {
  from?: number;
  running: boolean;
  onDone?: () => void;
  interval?: number;
  label?: string;
}) {
  const { reduced } = useMotion();
  const [n, setN] = useState(from);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    setN(from);
    if (!running) return;
    const timers = Array.from({ length: from }, (_, i) =>
      window.setTimeout(() => {
        if (i === from - 1) done.current?.();
        else setN(from - i - 1);
      }, (i + 1) * interval),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [running, from, interval]);

  const dots = digitDots(String(n));
  return (
    <div
      className="sant-count"
      data-idle={!running}
      data-animate={!reduced}
      style={{ "--sant-count-step": `${interval}ms` } as CSSProperties}
    >
      <span className="sant-count__ring" key={`ring-${n}-${running}`} aria-hidden="true">
        {Array.from({ length: RING }, (_, i) => (
          <span key={i} className="sant-count__tick" style={{ "--i": i, "--n": RING } as CSSProperties} />
        ))}
      </span>
      <span className="sant-count__digit" aria-hidden="true">
        {dots.map((on, i) => (
          <span key={i} className="sant-count__dot" data-on={on} style={{ "--row": Math.floor(i / 5) } as CSSProperties} />
        ))}
      </span>
      <span role="timer" className="sant-sr-only" aria-live="polite">
        {running ? `${label} ${n}` : `${from}-second countdown, not started`}
      </span>
    </div>
  );
}
