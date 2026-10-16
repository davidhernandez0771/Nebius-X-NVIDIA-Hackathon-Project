// Before/after for one demo: hand speed over time for the demo and, when it
// was derived from another, its parent. The backend serves no replay frames
// yet, so this stands in for the before/after clips.

import type { Trajectory } from "../types";
import { speedProfile, type SpeedProfile } from "./timeline";

const W = 600;
const H = 150;
const PAD = 24;

function path(p: SpeedProfile, start: number, tMax: number, vMax: number): string {
  return p.t
    .map((t, i) => {
      const x = PAD + ((t - start) / tMax) * (W - 2 * PAD);
      const y = H - PAD - (p.speed[i] / vMax) * (H - 2 * PAD);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function SpeedChart({ after, before }: { after: Trajectory; before?: Trajectory }) {
  const a = speedProfile(after);
  const b = before ? speedProfile(before) : null;
  const tMax = Math.max(a.duration, b?.duration ?? 0, 1e-6);
  const vMax = Math.max(...a.speed, ...(b?.speed ?? []), 1e-6);

  return (
    <figure className="pm-speed stack">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hand speed over time">
        <line className="pm-gridline" x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
        <line className="pm-gridline" x1={PAD} x2={W - PAD} y1={PAD} y2={PAD} />
        <text className="pm-chart-label" x={PAD} y={PAD - 8}>
          {vMax.toFixed(2)} m/s
        </text>
        <text className="pm-chart-label" x={W - PAD} y={H - 6} textAnchor="end">
          {tMax.toFixed(1)} s
        </text>
        {b && <path className="pm-line pm-line--before" d={path(b, before!.t[0], tMax, vMax)} />}
        <path className="pm-line pm-line--after" d={path(a, after.t[0], tMax, vMax)} />
      </svg>
      <figcaption className="muted small pm-num">
        {b ? (
          <>
            Before (warm): {b.duration.toFixed(1)} s, {b.pathLength.toFixed(2)} m of hand path. After (teal):{" "}
            {a.duration.toFixed(1)} s, {a.pathLength.toFixed(2)} m.
          </>
        ) : (
          <>
            {a.duration.toFixed(1)} s, {a.pathLength.toFixed(2)} m of hand path. A perfected demo shows its human
            parent here for comparison.
          </>
        )}
      </figcaption>
    </figure>
  );
}
