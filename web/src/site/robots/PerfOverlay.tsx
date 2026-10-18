// The ?perf overlay: a quiet readout of the probe, refreshed 4×/s (never per frame).
import { useEffect, useState } from "react";
import type { PerfProbe } from "./perf";

export function PerfOverlay({ probe }: { probe: PerfProbe }) {
  const [s, setS] = useState(() => probe.summary());
  useEffect(() => {
    const id = window.setInterval(() => setS(probe.summary()), 250);
    return () => window.clearInterval(id);
  }, [probe]);
  return (
    <pre className="robots-perf" aria-hidden="true">
      {Object.entries(s)
        .map(([k, v]) => `${k.padEnd(10)} ${v}`)
        .join("\n")}
    </pre>
  );
}
