import { useEffect, useState } from "react";
import { formatStat } from "../motion/format";

/**
 * Average frame time over the last 60 frames, so an effect can be judged on this machine
 * (Record runs MediaPipe next to Isaac Sim on one GPU).
 */
export function FrameMeter() {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return;
    const deltas: number[] = [];
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      deltas.push(now - last);
      last = now;
      if (deltas.length === 60) {
        setMs(deltas.reduce((a, b) => a + b, 0) / deltas.length);
        deltas.length = 0;
      }
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <span className="sant-design-meter">
      Frame time <span className="sant-num">{ms === null ? "measuring" : `${formatStat(ms, 1)} ms`}</span>, averaged over 60 frames
    </span>
  );
}
