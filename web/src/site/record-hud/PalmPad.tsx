import { RackTile, readout } from "./RackTile";

const W = 200;
const H = 160;
const GRID_X = [50, 100, 150];
const GRID_Y = [40, 80, 120];

/**
 * The palm inside the control region, as the user sees it: a dot on a gridded pad with crosshair
 * lines through it. At the edge of the region the arm stops following, so the dot turns amber.
 * `x` and `y` are 0..1 from the top left; null hides the dot (no hand yet).
 */
export function PalmPad({ x, y, edge = false }: { x: number | null; y: number | null; edge?: boolean }) {
  const has = x !== null && y !== null;
  const px = has ? 1 + x * (W - 2) : W / 2;
  const py = has ? 1 + y * (H - 2) : H / 2;
  const where = has ? `${readout(x, 2)} across, ${readout(y, 2)} down${edge ? ", at the edge" : ""}` : "no hand";
  return (
    <svg className="rh-pad" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Palm in the workspace: ${where}`}>
      <rect className="rh-pad__face" x="1" y="1" width={W - 2} height={H - 2} rx="2" />
      <g className="rh-pad__grid">
        {GRID_X.map((gx) => (
          <line key={`x${gx}`} x1={gx} y1="1" x2={gx} y2={H - 1} />
        ))}
        {GRID_Y.map((gy) => (
          <line key={`y${gy}`} x1="1" y1={gy} x2={W - 1} y2={gy} />
        ))}
      </g>
      {has && (
        <>
          <line className="rh-pad__cross" x1="1" y1={py} x2={W - 1} y2={py} />
          <line className="rh-pad__cross" x1={px} y1="1" x2={px} y2={H - 1} />
          <circle className="rh-pad__dot" data-edge={edge || undefined} cx={px} cy={py} r="4.5" />
        </>
      )}
    </svg>
  );
}

export function PalmPadTile({ x, y, edge = false }: { x: number | null; y: number | null; edge?: boolean }) {
  return (
    <RackTile label="palm_xy" unit="workspace">
      <div className="rh-instrument">
        <PalmPad x={x} y={y} edge={edge} />
      </div>
      <p className="rh-mid">
        {readout(x, 2)}, {readout(y, 2)}
      </p>
    </RackTile>
  );
}
