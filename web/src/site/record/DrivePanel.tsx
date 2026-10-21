// The camera pane on /record when the input is the keyboard or the mouse: the input switch's companion. A quiet key
// legend (robot frame, as if standing behind the robot), the speed or mouse-sensitivity slider (saved locally), and
// the gripper / fine-mode / mouse-lock state.

import type { RecordSession } from "../../record/useRecordSession";
import { MOUSE_SENS_MAX, MOUSE_SENS_MIN, SPEED_MAX, SPEED_MIN, INPUT_MODES, type InputMode } from "../../record/drive/drive";

const INPUT_LABEL: Record<InputMode, string> = { keyboard: "Keyboard", mouse: "Mouse", camera: "Camera" };

/** Keyboard | Mouse | Camera. Switching stops a running session; Start again in the new mode. */
export function InputSwitch({ session }: { session: RecordSession }) {
  const { drive } = session;
  return (
    <span className="rg-switch" role="radiogroup" aria-label="Input">
      {INPUT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={drive.input === mode}
          className="rg-switch__opt"
          onClick={() => drive.input !== mode && session.updateDrive({ ...drive, input: mode })}
        >
          {INPUT_LABEL[mode]}
        </button>
      ))}
    </span>
  );
}

const KEYS: [string, string][] = [
  ["W / ↑", "forward"],
  ["S / ↓", "back"],
  ["A / ←", "robot's left"],
  ["D / →", "robot's right"],
  ["R", "up"],
  ["F", "down"],
  ["Q / E", "turn the wrist"],
  ["Space", "gripper"],
  ["Shift", "fine (hold)"],
  ["Enter", "record / stop & save"],
];

const MOUSE: [string, string][] = [
  ["click twin", "take the mouse"],
  ["mouse ↑ / ↓", "forward / back"],
  ["mouse ← / →", "robot's left / right"],
  ["wheel · R / F", "up / down"],
  ["Shift+wheel · Q / E", "turn the wrist"],
  ["click · Space", "gripper"],
  ["Shift", "fine (hold)"],
  ["Esc", "release the mouse"],
  ["Enter", "record / stop & save"],
];

export function DrivePanel({ session }: { session: RecordSession }) {
  const { drive, driveUi, streaming } = session;
  const mouse = drive.input === "mouse";
  const legend = mouse ? MOUSE : KEYS;
  return (
    <div className="rg-drive">
      <p className="rg-drive__lead">
        {mouse ? "Mouse" : "Keyboard"} control, in the robot's own frame: as if you stand behind it. {streaming ? "" : mouse ? "Click the twin (or Start) to connect to the sim." : "Start to connect to the sim."}
      </p>
      <ul className="rg-keys" aria-label={mouse ? "Mouse controls" : "Keys"}>
        {legend.map(([k, what]) => (
          <li key={k} className="rg-keys__row">
            <kbd>{k}</kbd>
            <span>{what}</span>
          </li>
        ))}
      </ul>
      {mouse ? (
        <Slider
          label="Mouse sensitivity"
          shown={`${(drive.mouseSens * 1000).toFixed(2)} mm/px`}
          value={drive.mouseSens}
          min={MOUSE_SENS_MIN}
          max={MOUSE_SENS_MAX}
          step={0.00005}
          onChange={(v) => session.updateDrive({ ...drive, mouseSens: v })}
        />
      ) : (
        <Slider
          label="Speed"
          shown={`${Math.round(drive.speed * 100)} cm/s`}
          value={drive.speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.01}
          onChange={(v) => session.updateDrive({ ...drive, speed: v })}
        />
      )}
      {streaming && driveUi && (
        <p className="rg-drive__state" role="status">
          <span className="rg-chip" data-state={driveUi.gripper ? "rec" : "ok"}>
            <span className="rg-dot" aria-hidden="true" />
            gripper {driveUi.gripper ? "closed" : "open"}
          </span>
          {driveUi.fine && <span className="rg-chip">fine</span>}
          {mouse && <span className="rg-chip" data-state={driveUi.locked ? "ok" : "wait"}>
            <span className="rg-dot" aria-hidden="true" />
            {driveUi.locked ? "mouse · Esc releases" : "click the twin to drive"}
          </span>}
        </p>
      )}
    </div>
  );
}

function Slider({ label, shown, value, min, max, step, onChange }: { label: string; shown: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="rg-drive__slider">
      <span>
        {label} <b>{shown}</b>
      </span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
