// The hand lock chip: "locked: right hand" and a Re-pick button. A drop-in for the Record page's
// owner to place; the session's pose.lock and repickHand feed it:
//   <HandLockChip status={pose?.lock ?? null} onRepick={session.repickHand} />
// The stage canvas draws the same line itself (stageDraw.ts), so the lock shows without it.
//
// Display only: it renders a HandLockStatus from teleop/handLock.ts and decides nothing. Styles are
// inline (tokens.css only), like ResetGestureRing, because the page's CSS belongs to its owner.

import type { CSSProperties } from "react";
import { lockChipText, type HandLockStatus } from "./teleop/handLock";

export interface HandLockChipProps {
  /** The lock's latest status (PoseUi.lock); null before any frame. */
  status: HandLockStatus | null;
  /** Re-pick: the session's repickHand. */
  onRepick: () => void;
}

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "2px 4px 2px 10px",
  borderRadius: 999,
  font: "12px var(--font)",
  color: "var(--text)",
  background: "var(--surface)",
};
const button: CSSProperties = {
  font: "inherit",
  padding: "1px 8px",
  borderRadius: 999,
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

export default function HandLockChip({ status, onRepick }: HandLockChipProps) {
  if (!status) return null;
  const locked = status.phase === "locked" || status.phase === "holding";
  const border = locked ? "1px solid var(--accent)" : "1px dashed var(--warm-line)";
  return (
    <span role="status" data-phase={status.phase} style={{ ...chip, border, paddingRight: status.handedness ? 4 : 10 }}>
      {lockChipText(status)}
      {status.handedness && (
        <button type="button" style={button} onClick={onRepick} aria-label="Re-pick hand">
          Re-pick
        </button>
      )}
    </span>
  );
}
