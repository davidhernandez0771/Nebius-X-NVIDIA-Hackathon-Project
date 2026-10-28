import type { CSSProperties } from "react";
import { dialAngle, dialTicks } from "../motion/dial";
import { formatStat } from "../motion/format";
import { useMotion } from "../motion/MotionProvider";

const C = 80;
const R = 62;

function polar(angle: number, r: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

function arc(from: number, to: number, r: number) {
  const a = polar(from, r);
  const b = polar(to, r);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const tickText = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v));

/**
 * A rolling dial for the gripper, the reach or a joint angle: the scale turns under a fixed index
 * mark at the top, so the value always reads in the same place and the precise number sits in
 * the middle. The lit arc runs from the start of the range to the index.
 */
export function Dial({
  label,
  value,
  min,
  max,
  unit,
  step,
  major,
  decimals = 0,
  sweep = 240,
  tone = "live",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  step: number;
  major: number;
  decimals?: number;
  sweep?: number;
  tone?: "live" | "issue" | "info";
}) {
  const { reduced } = useMotion();
  const angle = dialAngle(value, min, max, sweep);
  const ticks = dialTicks(min, max, step, major, sweep);
  const shown = formatStat(value, decimals).replace("-", "−");
  return (
    <div
      className="sant-dial"
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${shown} ${unit}`}
      data-tone={tone}
      data-animate={!reduced}
    >
      <svg className="sant-dial__svg" viewBox="0 0 160 160" aria-hidden="true">
        <circle className="sant-dial__bezel" cx={C} cy={C} r={R + 12} />
        <g className="sant-dial__scale" style={{ transform: `rotate(${-angle}deg)` } as CSSProperties}>
          <path className="sant-dial__track" d={arc(-sweep / 2, sweep / 2, R)} />
          {angle > -sweep / 2 && <path className="sant-dial__lit" d={arc(-sweep / 2, angle, R)} />}
          {ticks.map((t) => {
            const a = polar(t.angle, R + 3);
            const b = polar(t.angle, R + (t.major ? 11 : 7));
            return <line key={t.value} className="sant-dial__tick" data-major={t.major} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {ticks
            .filter((t) => t.major)
            .map((t) => {
              const p = polar(t.angle, R - 11);
              // A number rolled into the lower half turns over, so it never reads upside down ("06").
              const turn = t.angle + (Math.abs(t.angle - angle) > 90 ? 180 : 0);
              return (
                <text key={t.value} className="sant-dial__num" x={p.x} y={p.y} transform={`rotate(${turn} ${p.x} ${p.y})`}>
                  {tickText(t.value)}
                </text>
              );
            })}
        </g>
        <path className="sant-dial__index" d={`M${C} ${C - R - 14}l-4.5 -7h9z`} />
      </svg>
      <span className="sant-dial__readout">
        <span className="sant-dial__value">{shown}</span>
        <span className="sant-dial__unit">{unit}</span>
      </span>
      <span className="sant-dial__label">{label}</span>
    </div>
  );
}
