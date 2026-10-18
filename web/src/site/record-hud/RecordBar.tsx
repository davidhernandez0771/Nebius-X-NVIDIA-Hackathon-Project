import { formatClock } from "./hudModel";
import "./record-hud.css";

export type ChipState = "ok" | "wait" | "off";

export type Chip = { label: string; state: ChipState; detail?: string };

const SPOKEN: Record<ChipState, string> = { ok: "ok", wait: "waiting", off: "off" };

/**
 * A status chip: the channel name in words, a dot for its state. Teal is ok, amber is waiting,
 * a hollow ring is off, so the shape changes with the colour. `detail` replaces the spoken state
 * ("lost", "after recording").
 */
export function StatusChip({ label, state, detail }: Chip) {
  return (
    <span className="rh-chip" data-state={state}>
      <span className="rh-chip__dot" aria-hidden="true" />
      {label}
      {detail ? <span className="rh-chip__detail">{detail}</span> : <span className="sant-sr-only">: {SPOKEN[state]}</span>}
    </span>
  );
}

export type RecordState = "idle" | "recording" | "paused";

const SHOWN: Record<RecordState, string> = { idle: "record", recording: "recording", paused: "paused" };

/** The record toggle and its timer. The button's name stays "Record"; aria-pressed carries the state. */
export function RecordControl({
  state,
  elapsedMs,
  onToggle,
  disabled = false,
}: {
  state: RecordState;
  elapsedMs: number;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rh-rec">
      <button
        type="button"
        className="rh-rec__btn"
        aria-label="Record"
        aria-pressed={state === "recording"}
        data-state={state}
        disabled={disabled}
        onClick={onToggle}
      >
        <i aria-hidden="true" />
        <span aria-hidden="true">{SHOWN[state]}</span>
      </button>
      <span className="rh-rec__time" role="timer" aria-label="Recording time">
        {formatClock(elapsedMs)}
      </span>
    </div>
  );
}

/** The rack's top bar: where you are, the link and tracking chips, and the record control. */
export function RecordBar({
  path = [],
  chips,
  state,
  elapsedMs,
  onToggle,
  disabled,
}: {
  path?: string[];
  chips: Chip[];
  state: RecordState;
  elapsedMs: number;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rh-bar">
      {path.length > 0 && (
        <p className="rh-bar__path">
          {path.map((p, i) => (
            <span key={p}>
              {i > 0 && <span aria-hidden="true"> / </span>}
              {i === 0 ? <b>{p}</b> : p}
            </span>
          ))}
        </p>
      )}
      <div className="rh-bar__chips" role="group" aria-label="Status">
        {chips.map((c) => (
          <StatusChip key={c.label} {...c} />
        ))}
      </div>
      <RecordControl state={state} elapsedMs={elapsedMs} onToggle={onToggle} disabled={disabled} />
    </div>
  );
}
