import { useId, useState } from "react";
import { pct } from "./fmt";
import { layerLabel, reachCells } from "./report";
import type { ReportCard } from "./types";

const CELL = 26;
const GAP = 2;
const PAD = { left: 52, bottom: 30, top: 8, right: 8 };
const MINUS = "−";
const m = (v: number) => `${v < 0 ? MINUS : v > 0 ? "+" : ""}${Math.abs(v).toFixed(2)}`;

/**
 * The reach map seen from above, the robot at the bottom: each cell is shaded by how many of the task's five tool
 * poses reach it, unreachable cells are hatched, and each scene's cube sits on top (filled: done, ring: failed).
 */
export function ReachMap({ report }: { report: ReportCard }) {
  const id = useId().replace(/:/g, "");
  const { grid, layers } = report.reach_map;
  const cells = reachCells(report);
  const nx = grid.x.length;
  const ny = grid.y.length;
  const w = PAD.left + ny * CELL + PAD.right;
  const h = PAD.top + nx * CELL + PAD.bottom;
  const [hover, setHover] = useState<string | null>(null);

  // x away from the robot runs up the screen; +y (the robot's left) is on the left.
  const col = (y: number) => (grid.y[ny - 1] - y) / (grid.y[1] - grid.y[0]);
  const row = (x: number) => (grid.x[nx - 1] - x) / (grid.x[1] - grid.x[0]);
  const cx = (y: number) => PAD.left + (col(y) + 0.5) * CELL;
  const cy = (x: number) => PAD.top + (row(x) + 0.5) * CELL;

  const total = layers.length;
  const scenes = report.scenes.rows;
  const summary = `The tool reaches ${pct(report.reach_map.fraction.value)} of the cells in all ${total} poses.`;

  return (
    <figure className="byor-reach">
      <svg
        className="byor-reach__map"
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        role="img"
        aria-labelledby={`${id}-cap`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" className="byor-reach__hatch" />
          </pattern>
        </defs>
        {cells.map((rowCells, i) =>
          rowCells.map((c, j) => {
            const x = PAD.left + (ny - 1 - j) * CELL + GAP / 2;
            const y = PAD.top + (nx - 1 - i) * CELL + GAP / 2;
            const which = layers.filter((_, k) => c.layers[k]).map(layerLabel);
            const text = `${c.x.toFixed(2)} m out, ${m(c.y)} m across: ${c.count === 0 ? "no pose reaches it" : `${c.count} of ${total} poses (${which.join(", ")})`}`;
            return (
              <rect
                key={`${i}-${j}`}
                x={x}
                y={y}
                width={CELL - GAP}
                height={CELL - GAP}
                rx={3}
                className="byor-reach__cell"
                data-count={c.count}
                data-all={c.count === total}
                fill={c.count === 0 ? `url(#${id}-hatch)` : undefined}
                style={c.count ? { fillOpacity: 0.16 + (0.7 * c.count) / total } : undefined}
                onMouseEnter={() => setHover(text)}
              />
            );
          }),
        )}
        {scenes.map((s) => {
          const text = `Seed ${s.seed}: ${s.success ? "done" : `failed (${s.reasons.join(", ").replace(/_/g, " ")})`}, cube at ${s.cube[0].toFixed(2)}, ${m(s.cube[1])}`;
          return (
            <g key={s.seed} className="byor-reach__scene" data-ok={s.success} onMouseEnter={() => setHover(text)}>
              <circle cx={cx(s.cube[1])} cy={cy(s.cube[0])} r={9} className="byor-reach__hit" />
              <circle cx={cx(s.cube[1])} cy={cy(s.cube[0])} r={4} className="byor-reach__cube" />
            </g>
          );
        })}
        {grid.x.map((x, i) => (
          <text key={x} x={PAD.left - 8} y={PAD.top + (nx - 1 - i + 0.5) * CELL} className="byor-reach__tick" textAnchor="end" dominantBaseline="middle">
            {x.toFixed(2)}
          </text>
        ))}
        {grid.y.map((y, j) =>
          j % 2 === 0 ? (
            <text key={y} x={PAD.left + (ny - 1 - j + 0.5) * CELL} y={PAD.top + nx * CELL + 16} className="byor-reach__tick" textAnchor="middle">
              {m(y)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption id={`${id}-cap`} className="byor-reach__cap">
        <span className="byor-reach__readout" aria-live="polite">
          {hover ?? summary}
        </span>
        <span className="byor-reach__axes">Seen from above, the robot at the bottom. Rows: metres in front of the base. Columns: metres to its left (+) and right (−).</span>
        <span className="byor-reach__legend">
          <span>
            <i className="byor-key byor-key--all" /> all {total} poses
          </span>
          <span>
            <i className="byor-key byor-key--some" /> some
          </span>
          <span>
            <i className="byor-key byor-key--none" /> none
          </span>
          <span>
            <i className="byor-key byor-key--ok" /> scene done
          </span>
          <span>
            <i className="byor-key byor-key--fail" /> scene failed
          </span>
        </span>
      </figcaption>

      <ol className="byor-layers" aria-label="Each pose on its own">
        {layers.map((l, k) => {
          const share = l.fraction ?? l.reachable.flat().filter(Boolean).length / (nx * ny);
          return (
            <li key={k} className="byor-layer">
              <svg viewBox={`0 0 ${ny * 6} ${nx * 6}`} className="byor-layer__map" aria-hidden="true">
                {l.reachable.map((r, i) =>
                  r.map((ok, j) => <rect key={`${i}-${j}`} x={(ny - 1 - j) * 6} y={(nx - 1 - i) * 6} width={5} height={5} rx={1} data-ok={ok} />),
                )}
              </svg>
              <span className="byor-layer__name">{layerLabel(l)}</span>
              <span className="byor-layer__pct sant-num">{pct(share)}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
