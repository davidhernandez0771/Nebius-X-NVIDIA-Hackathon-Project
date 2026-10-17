// "Hand control" settings for webcam teleop: the browser-side control region and depth range
// (web/src/teleop/controlRegion.ts). Reuses the look of SANT's hand-cursor CalibrationPanel
// (its calibration-field classes), but holds the teleop region, stored under pm.teleop.region.

import { GlassCard } from "../../components";
import "../../hand/overlay/calibrationPanel.css";
import {
  DEFAULT_TELEOP_CONTROL,
  REGION_SIZE_MAX,
  clampRegion,
  type CalibrationState,
  type TeleopControlSettings,
} from "../../teleop/controlRegion";

const SIZE_MIN = 0.2; // SANT's slider range; calibration may go a little smaller
const DEPTH_MIN = 0.03;
const DEPTH_MAX = 0.3;
const DEPTH_GAP = 0.01; // far stays at least this far below near

const STEP_TEXT: Record<CalibrationState["step"], string> = {
  move: "Move your hand slowly around the space you want to use: left, right, up, and down to where the table should be. Keep your whole hand in view.",
  near: "Now hold your hand comfortably close to the camera (the arm reaches forward).",
  far: "Now hold your hand back, away from the camera (the arm pulls back).",
  done: "",
  failed: "",
};

type Props = {
  settings: TeleopControlSettings;
  onChange: (s: TeleopControlSettings) => void;
  canCalibrate: boolean;
  calibration: CalibrationState | null;
  onCalibrate: () => void;
  onCancelCalibration: () => void;
  readout: { palmWidth: number | null; pinch: number | null };
};

export function HandControlPanel({ settings, onChange, canCalibrate, calibration, onCalibrate, onCancelCalibration, readout }: Props) {
  const r = settings.region;
  const set = (patch: Partial<TeleopControlSettings>) => onChange({ ...settings, ...patch });
  const setRegion = (patch: Partial<typeof r>) => set({ region: clampRegion({ ...r, ...patch }) });
  const bottomPercent = Math.round((r.centerY + r.height / 2) * 100);
  const running = calibration && calibration.step !== "done" && calibration.step !== "failed";

  return (
    <GlassCard as="section" className="stack">
      <h2>Hand control</h2>
      <p className="muted small">
        The center of your palm moves the arm. The dashed box on the camera view is your control region: small
        movements inside it reach the whole workspace, and the bottom edge of the box is table height.
      </p>

      <label className="row">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Use the control region</span>
      </label>

      <label className="calibration-field">
        <span className="calibration-field-label">
          <span>Region size</span>
          <span className="calibration-field-value">{Math.round(r.width * 100)}%</span>
        </span>
        <input
          type="range"
          aria-label="Region size"
          min={SIZE_MIN}
          max={REGION_SIZE_MAX}
          step={0.01}
          value={r.width}
          disabled={!settings.enabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRegion({ width: v, height: v });
          }}
        />
        <span className="calibration-field-hint">Smaller = less hand movement to reach every edge.</span>
      </label>

      <label className="calibration-field">
        <span className="calibration-field-label">
          <span>Vertical position</span>
          <span className="calibration-field-value">bottom at {bottomPercent}% of the frame</span>
        </span>
        <input
          type="range"
          aria-label="Vertical position"
          min={r.height / 2}
          max={1 - r.height / 2}
          step={0.01}
          value={r.centerY}
          disabled={!settings.enabled}
          onChange={(e) => setRegion({ centerY: Number(e.target.value) })}
        />
        <span className="calibration-field-hint">Raise it if reaching the table pushes your hand out of the frame.</span>
      </label>

      <label className="calibration-field">
        <span className="calibration-field-label">
          <span>Depth: far</span>
          <span className="calibration-field-value">palm {settings.depthFar.toFixed(3)}</span>
        </span>
        <input
          type="range"
          aria-label="Depth far (palm width)"
          min={DEPTH_MIN}
          max={DEPTH_MAX}
          step={0.005}
          value={settings.depthFar}
          disabled={!settings.enabled}
          onChange={(e) => set({ depthFar: Math.min(Number(e.target.value), settings.depthNear - DEPTH_GAP) })}
        />
      </label>

      <label className="calibration-field">
        <span className="calibration-field-label">
          <span>Depth: near</span>
          <span className="calibration-field-value">palm {settings.depthNear.toFixed(3)}</span>
        </span>
        <input
          type="range"
          aria-label="Depth near (palm width)"
          min={DEPTH_MIN}
          max={DEPTH_MAX}
          step={0.005}
          value={settings.depthNear}
          disabled={!settings.enabled}
          onChange={(e) => set({ depthNear: Math.max(Number(e.target.value), settings.depthFar + DEPTH_GAP) })}
        />
        <span className="calibration-field-hint">
          Palm width now: {readout.palmWidth !== null ? readout.palmWidth.toFixed(3) : "–"}. Hand far = arm back, hand
          near = arm forward.
        </span>
      </label>

      <label className="row">
        <input type="checkbox" checked={settings.invertY} onChange={(e) => set({ invertY: e.target.checked })} />
        <span>Invert up-down</span>
      </label>
      <label className="row">
        <input type="checkbox" checked={settings.invertX} onChange={(e) => set({ invertX: e.target.checked })} />
        <span>Invert left-right</span>
      </label>

      {running ? (
        <div className="stack" role="status">
          <p className="small">{STEP_TEXT[calibration.step]}</p>
          <progress max={1} value={calibration.progress} aria-label="Calibration step progress" />
          <button type="button" className="ghost-button" onClick={onCancelCalibration}>
            Cancel calibration
          </button>
        </div>
      ) : (
        <button type="button" className="ghost-button" onClick={onCalibrate} disabled={!canCalibrate}>
          Calibrate by hand
        </button>
      )}
      {calibration?.step === "done" && (
        <p className="small" role="status">
          Calibrated: region {Math.round(r.width * 100)}%, bottom at {bottomPercent}% of the frame, palm{" "}
          {settings.depthFar.toFixed(3)} to {settings.depthNear.toFixed(3)}.
        </p>
      )}
      {calibration?.step === "failed" && (
        <p className="small" role="alert">
          {calibration.error}
        </p>
      )}
      {!canCalibrate && !running && <p className="muted small">Start the camera to calibrate by hand.</p>}

      <button type="button" className="calibration-panel-reset" onClick={() => onChange(DEFAULT_TELEOP_CONTROL)}>
        Reset to defaults
      </button>

      <dl className="pm-status-list pm-num">
        <dt>Pinch</dt>
        <dd>{readout.pinch !== null ? readout.pinch.toFixed(2) : "–"}</dd>
      </dl>
    </GlassCard>
  );
}
