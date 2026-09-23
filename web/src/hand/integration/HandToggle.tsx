import Icon from "../../components/Icon";
import type { TrackingStatus } from "../contracts";
import "./handToggle.css";

type Props = {
  enabled: boolean;
  status: TrackingStatus;
  onEnable: () => Promise<void>;
  onDisable: () => void;
};

/**
 * The one real, clickable control for the hand cursor (requirement 1 keeps
 * the overlay itself pointer-events: none end to end, so this can't live
 * there -- see HANDOFF_AGENT3.md). Explicit opt-in/opt-out (requirement 10):
 * the camera is never touched before this is pressed.
 *
 * Always clickable, even while status is "loading" or "error" -- a camera
 * permission prompt can sit unanswered indefinitely (denied silently,
 * ignored, or just slow), and the user must always have a working way to
 * back out, not get stuck behind a disabled button waiting on a promise
 * that may never settle.
 */
export function HandToggle({ enabled, status, onEnable, onDisable }: Props) {
  function handleClick() {
    if (enabled) {
      onDisable();
    } else {
      void onEnable();
    }
  }

  const label = !enabled
    ? "Hand control"
    : status === "loading"
      ? "Starting…"
      : status === "error"
        ? "Hand tracking error"
        : "Hand control on";

  return (
    <button
      type="button"
      className="hand-toggle"
      data-enabled={enabled}
      data-status={status}
      aria-pressed={enabled}
      aria-label={label}
      onClick={handleClick}
    >
      <Icon name="camera" size={16} />
      <span>{label}</span>
    </button>
  );
}
