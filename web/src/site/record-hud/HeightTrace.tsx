import type { CSSProperties } from "react";
import { HISTORY } from "./hudModel";
import { RackTile, readout } from "./RackTile";

const VW = 240;
const VH = 100;
const PAD = 3;

type Range = readonly [number, number];

function yOf(v: number, [lo, hi]: Range) {
  const f = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return VH - PAD - f * (VH - 2 * PAD);
}

function points(history: readonly number[], range: Range, capacity: number) {
  const step = VW / (capacity - 1);
  return history.map((v, i) => `${(i * step).toFixed(1)},${yOf(v, range).toFixed(1)}`).join(" ");
}

/**
 * A scrolling trace: the main series bright, an optional second one faint behind it, dashed
 * reference marks (named in the tile's legend, not on the plot), and a dot on the newest sample.
 * Drawn as SVG so the line stays crisp at any width; new samples fill from the left until the
 * window is full, then the window scrolls.
 */
export function Trace({
  history,
  range,
  secondary,
  marks = [],
  capacity = HISTORY,
  label,
}: {
  history: readonly number[];
  range: Range;
  secondary?: { history: readonly number[]; range: Range };
  marks?: { value: number; label: string }[];
  capacity?: number;
  label: string;
}) {
  const n = history.length;
  const head = n ? { left: `${((n - 1) / (capacity - 1)) * 100}%`, top: `${(yOf(history[n - 1], range) / VH) * 100}%` } : null;
  return (
    <div className="rh-trace" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
        <g className="rh-trace__grid">
          {[1, 2, 3].map((g) => (
            <line key={g} x1="0" y1={(VH * g) / 4} x2={VW} y2={(VH * g) / 4} />
          ))}
        </g>
        {marks.map((m) => (
          <line key={m.label} className="rh-trace__mark" x1="0" y1={yOf(m.value, range)} x2={VW} y2={yOf(m.value, range)} />
        ))}
        {secondary && secondary.history.length > 1 && (
          <polyline className="rh-trace__line rh-trace__line--faint" points={points(secondary.history, secondary.range, capacity)} />
        )}
        {n > 1 && <polyline className="rh-trace__line" points={points(history, range, capacity)} />}
      </svg>
      {head && <span className="rh-trace__head" style={head as CSSProperties} aria-hidden="true" />}
    </div>
  );
}

/** ee_target_z, wide: the height large, then height (bright) and reach (faint) over the last 8 s. */
export function HeightTraceTile({
  z,
  zHistory,
  zRange,
  xHistory,
  xRange,
  graspZ,
  capacity,
}: {
  z: number | null;
  zHistory: readonly number[];
  zRange: Range;
  xHistory: readonly number[];
  xRange: Range;
  graspZ?: number;
  /** Samples across the trace (default HISTORY, 8 s at ~30 Hz); pass the count for 8 s at another rate. */
  capacity?: number;
}) {
  return (
    <RackTile label="ee_target_z · height" unit="m" span="wide">
      <p className="rh-val">
        {readout(z, 3)}
        <small>m</small>
      </p>
      <Trace
        history={zHistory}
        range={zRange}
        secondary={{ history: xHistory, range: xRange }}
        marks={graspZ === undefined ? [] : [{ value: graspZ, label: "grasp_z" }]}
        capacity={capacity}
        label="Height, and reach behind it, over the last 8 seconds"
      />
      <p className="rh-legend" aria-hidden="true">
        <span className="rh-legend__key">height</span>
        <span className="rh-legend__key rh-legend__key--faint">reach</span>
        {graspZ !== undefined && <span className="rh-legend__key rh-legend__key--mark">grasp_z</span>}
      </p>
    </RackTile>
  );
}
