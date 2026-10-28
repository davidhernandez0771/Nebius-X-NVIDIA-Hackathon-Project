// A top-down map of the table: where each episode's cube started (or where its bin was), coloured and shaped by how
// the episode ended, with a recipe's region drawn over it. The robot sits at the bottom facing up (+x), its left
// (+y) on the left, so the map reads as the robot's own view. One scale for both axes: a metre is a metre.
import { useState } from "react";
import { OUTCOMES, outcomeOf, scale, ticks, type Point, type Range } from "./model";

export type MapRegion = { name: string; x: Range; y: Range; kind: "nemotron" | "rules"; label: string };

const W = 360;
const PAD = { l: 34, r: 12, t: 20, b: 30 };

function Mark({ shape, x, y }: { shape: string; x: number; y: number }) {
  const s = 5;
  if (shape === "triangle") return <path d={`M${x},${y - s - 1} L${x + s + 1},${y + s} L${x - s - 1},${y + s} Z`} />;
  if (shape === "square") return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} rx={1} />;
  if (shape === "diamond") return <path d={`M${x},${y - s - 1} L${x + s + 1},${y} L${x},${y + s + 1} L${x - s - 1},${y} Z`} />;
  return <circle cx={x} cy={y} r={s} />;
}

export function SceneMap({ title, points, which, x, y, regions }: { title: string; points: Point[]; which: "cube" | "bin"; x: Range; y: Range; regions: MapRegion[] }) {
  const [hover, setHover] = useState<Point | null>(null);
  const plotW = W - PAD.l - PAD.r;
  const plotH = (plotW * (x[1] - x[0])) / (y[1] - y[0]);
  const H = plotH + PAD.t + PAD.b;
  const sx = scale([y[1], y[0]], [PAD.l, PAD.l + plotW]); // robot y -> across, left on the left
  const sy = scale([x[0], x[1]], [PAD.t + plotH, PAD.t]); // robot x -> up
  const at = (p: Point) => (which === "cube" ? p.cube : p.bin);
  const shapeOf = (p: Point) => OUTCOMES.find((o) => o.id === outcomeOf(p))!.shape;
  // failures drawn last, so a success never hides one
  const order = [...points].sort((a, b) => Number(!a.success) - Number(!b.success));

  return (
    <figure className="an-map">
      <figcaption className="an-map__title">{title}</figcaption>
      <div className="an-map__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.length} episodes`}>
          <rect className="an-map__table" x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
          {ticks(y).map((v) => (
            <g key={`y${v}`}>
              <line className="an-map__grid" x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={PAD.t + plotH} />
              <text className="an-map__tick" x={sx(v)} y={PAD.t + plotH + 14} textAnchor="middle">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {ticks(x).map((v) => (
            <g key={`x${v}`}>
              <line className="an-map__grid" x1={PAD.l} x2={PAD.l + plotW} y1={sy(v)} y2={sy(v)} />
              <text className="an-map__tick" x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          <text className="an-map__axis" x={4} y={PAD.t - 2}>
            x (m) ↑ away from the robot
          </text>
          <text className="an-map__axis" x={PAD.l + plotW / 2} y={H - 4} textAnchor="middle">
            y (m) · robot's left ← → right
          </text>
          {regions.map((r) => (
            <g key={`${r.kind}-${r.name}`} className={`an-map__region an-map__region--${r.kind}`}>
              <rect x={sx(r.y[1])} y={sy(r.x[1])} width={sx(r.y[0]) - sx(r.y[1])} height={sy(r.x[0]) - sy(r.x[1])}>
                <title>{r.label}</title>
              </rect>
            </g>
          ))}
          {order.map((p) => {
            const [px, py] = at(p);
            const cx = sx(py);
            const cy = sy(px);
            return (
              <g
                key={p.seed}
                className={`an-mark an-mark--${outcomeOf(p)}`}
                tabIndex={0}
                aria-label={`seed ${p.seed}: ${p.success ? "succeeded" : (p.reasons.join(", ") || "failed")}`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p)}
                onBlur={() => setHover(null)}
              >
                <circle className="an-mark__hit" cx={cx} cy={cy} r={11} />
                <Mark shape={shapeOf(p)} x={cx} y={cy} />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div
            className="an-tip"
            role="status"
            style={{ left: `${(sx(at(hover)[1]) / W) * 100}%`, top: `${(sy(at(hover)[0]) / H) * 100}%` }}
          >
            <strong>seed {hover.seed}</strong>
            {hover.test ? " · test" : " · selection"}
            <br />
            {hover.success ? "succeeded" : hover.reasons.join(", ") || "failed"}
            <br />
            {which} at x {at(hover)[0].toFixed(2)}, y {at(hover)[1].toFixed(2)} m
          </div>
        )}
      </div>
    </figure>
  );
}
