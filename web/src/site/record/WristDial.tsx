// The wrist's turn as a tiny dial in the twin pane's header: the yaw_rad the page sends (Q / E or Shift+wheel with the
// keyboard and the mouse, the hand's own turn with the camera), -90 to +90 degrees, + counter-clockwise from above.
// The sim clamps it there too (to_ee_target's yaw_limit) and saves it in each demo's orientations.

const MAX = Math.PI / 2;

/** "+35°", "-12°", "0°". */
export function wristText(yaw: number): string {
  const deg = Math.round((Math.max(-MAX, Math.min(MAX, yaw)) * 180) / Math.PI);
  return `${deg > 0 ? "+" : ""}${deg}°`;
}

export function WristDial({ yaw }: { yaw: number | null }) {
  const a = yaw === null ? 0 : Math.max(-MAX, Math.min(MAX, yaw));
  // a half dial opening upward: 0 straight up, +90 to the left (counter-clockwise), -90 to the right
  const x = 9 - 7 * Math.sin(a);
  const y = 9 - 7 * Math.cos(a);
  const text = yaw === null ? "—" : wristText(yaw);
  return (
    <span
      className="rg-wrist"
      role="meter"
      aria-label="Wrist angle"
      aria-valuemin={-90}
      aria-valuemax={90}
      aria-valuenow={yaw === null ? undefined : Math.round((a * 180) / Math.PI)}
      aria-valuetext={yaw === null ? "no target" : `${text}${a > 0 ? " counter-clockwise" : a < 0 ? " clockwise" : ""}`}
      title="Wrist angle (Q / E, Shift+wheel; the hand's turn with the camera)"
    >
      <svg width="18" height="11" viewBox="0 0 18 11" aria-hidden="true">
        <path d="M2 9 A7 7 0 0 1 16 9" fill="none" stroke="currentColor" strokeOpacity="0.4" />
        <line x1="9" y1="9" x2={x.toFixed(2)} y2={y.toFixed(2)} stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>wrist {text}</span>
    </span>
  );
}
