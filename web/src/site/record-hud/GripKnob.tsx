import { GRIPPER, knobAngle } from "./hudModel";
import { RackTile, readout } from "./RackTile";

const C = 80;
const SCALE = [-135, -67, 0, 67, 135];

/**
 * The grip as a knob. The needle follows the pinch ratio (thumb-to-index gap over palm width),
 * turning clockwise as the fingers close; the two marks are the sim's latch thresholds, so you can
 * see how far you are from closing (below `closeBelow`) or opening (above `openAbove`). Not a
 * gauge: no lit arc, no redline, one needle. `stale` dims it at the last pinch seen while the
 * hand is lost (the sim holds the gripper meanwhile).
 */
export function GripKnob({
  pinch,
  closed,
  stale = false,
  max = 1.5,
  thresholds = [GRIPPER.openAbove, GRIPPER.closeBelow],
}: {
  pinch: number | null;
  closed: boolean;
  stale?: boolean;
  max?: number;
  /** The latch thresholds to mark on the scale; the sim's GripperLatch by default. */
  thresholds?: readonly number[];
}) {
  const angle = pinch === null ? -135 : knobAngle(pinch, 0, max, true);
  const marks = thresholds.map((v) => knobAngle(v, 0, max, true));
  return (
    <div
      className="rh-knob"
      data-stale={stale || undefined}
      role="meter"
      aria-label="Gripper"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={pinch ?? undefined}
      aria-valuetext={`${closed ? "closed" : "open"}, pinch ${readout(pinch, 2)}${stale ? ", last seen" : ""}`}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <g className="rh-knob__scale">
          {SCALE.map((a) => (
            <line key={a} x1={C} y1="14" x2={C} y2="22" transform={`rotate(${a} ${C} ${C})`} />
          ))}
        </g>
        <g className="rh-knob__marks">
          {marks.map((a) => (
            <line key={a} x1={C} y1="10" x2={C} y2="26" transform={`rotate(${a.toFixed(1)} ${C} ${C})`} />
          ))}
        </g>
        <circle className="rh-knob__bezel" cx={C} cy={C} r="46" />
        <circle className="rh-knob__face" cx={C} cy={C} r="38" />
        <g transform={`rotate(${angle.toFixed(1)} ${C} ${C})`}>
          <rect className="rh-knob__needle" x="78" y="44" width="4" height="16" rx="2" />
        </g>
      </svg>
    </div>
  );
}

/** `gripper` null: no command yet (before the first tracked hand). */
export function GripKnobTile({
  pinch,
  gripper,
  stale = false,
  thresholds,
  unit = "pinch",
}: {
  pinch: number | null;
  gripper: 0 | 1 | null;
  stale?: boolean;
  thresholds?: readonly number[];
  unit?: string;
}) {
  const closed = gripper === 1;
  return (
    <RackTile label="gripper_cmd" unit={unit} selected={closed}>
      <div className="rh-instrument">
        <GripKnob pinch={pinch} closed={closed} stale={stale} thresholds={thresholds} />
      </div>
      <p className="rh-mid">{gripper === null ? "—" : `${gripper} ${closed ? "closed" : "open"}`}</p>
    </RackTile>
  );
}
