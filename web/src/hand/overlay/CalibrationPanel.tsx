import { useEffect, useId, useRef, useState } from "react";
import { CURSOR_SHAPES, DEFAULT_INTERACTION_COLOR, type CursorShape, type HandPointerApi } from "../contracts";
import { CalibrationWizard } from "./CalibrationWizard";
import "./calibrationPanel.css";

type Props = {
  api: HandPointerApi;
  open: boolean;
  onClose: () => void;
};

// Slider ranges: generous enough to matter, conservative enough that the
// region can't be shrunk to nothing or pushed fully off-frame. centerX is
// intentionally not exposed -- see contracts.ts (only vertical position and
// size are meant to be user-adjustable).
const SIZE_MIN = 0.2;
const SIZE_MAX = 0.9;
const CENTER_Y_MIN = 0.3;
const CENTER_Y_MAX = 0.75;

// A handful of hues spread across the wheel, so there's a good chance one of
// them contrasts against whatever's actually behind the cursor (real camera/
// 3D content, unpredictable). DEFAULT_INTERACTION_COLOR first so "the
// default" is recognizable as a preset too, not just what Reset produces.
const COLOR_PRESETS: { hex: string; name: string }[] = [
  { hex: DEFAULT_INTERACTION_COLOR, name: "Amber (default)" },
  { hex: "#35f0d0", name: "Teal" },
  { hex: "#ff4fd8", name: "Magenta" },
  { hex: "#4fa8ff", name: "Sky blue" },
  { hex: "#8aff4f", name: "Lime" },
];

const SHAPE_LABELS: Record<CursorShape, string> = {
  square: "Square",
  circle: "Circle (default)",
  "rounded-square": "Rounded square",
  diamond: "Diamond",
};

/**
 * Calibration UI: comfortable-movement control region (Revision 3) plus
 * interaction color (Revision 4). A real, normally-interactive popover --
 * unlike HandCursorOverlay, this is NOT part of the pointer-events:none
 * layer, so it's a separate component.
 *
 * Purely presentational against HandPointerApi's controlRegion/
 * interactionColor fields; does not touch localStorage (the integration
 * layer persists both). `open`/`onClose` are controlled from outside --
 * this component builds no trigger button of its own (Agent 4 wires one in
 * near HandToggle).
 */
export function CalibrationPanel({ api, open, onClose }: Props) {
  const {
    controlRegion,
    setControlRegion,
    resetControlRegion,
    interactionColor,
    setInteractionColor,
    resetInteractionColor,
    cursorShape,
    setCursorShape,
    resetCursorShape,
  } = api;
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Escape to close, and move focus in when opened -- the panel has no
  // backdrop/outside-click dismissal (a hand-driven .click() elsewhere in
  // the app while this is open should not have surprising side effects on
  // it), so keyboard/close-button are the only ways out.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Reopening the panel later should land back on the normal sliders view,
  // not mid-wizard from a previous session.
  useEffect(() => {
    if (!open) setWizardOpen(false);
  }, [open]);

  if (!open) return null;

  const sizePercent = Math.round(controlRegion.width * 100);
  const verticalLabel =
    controlRegion.centerY < 0.45 ? "Raised" : controlRegion.centerY > 0.55 ? "Lowered" : "Centered";

  // Schematic region preview (see HANDOFF_AGENT3.md): no live camera feed is
  // available through the current contract, so this draws the region
  // rectangle, to scale, over a placeholder frame instead.
  const left = Math.max(0, controlRegion.centerX - controlRegion.width / 2) * 100;
  const top = Math.max(0, controlRegion.centerY - controlRegion.height / 2) * 100;
  const width = Math.min(controlRegion.width, 1 - left / 100) * 100;
  const height = Math.min(controlRegion.height, 1 - top / 100) * 100;

  const isCustomColorActive = !COLOR_PRESETS.some((p) => p.hex.toLowerCase() === interactionColor.toLowerCase());

  return (
    <div
      ref={panelRef}
      className="calibration-panel"
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <header className="calibration-panel-header">
        <h2 id={headingId}>Hand cursor calibration</h2>
        <button type="button" className="calibration-panel-close" aria-label="Close calibration" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="calibration-instructions">
        Bring your <strong>index and middle fingers together</strong> to select. Over the 3D viewer, pinch{" "}
        <strong>thumb and index on both hands</strong> and move them apart or together to zoom.
      </p>

      {wizardOpen ? (
        <CalibrationWizard api={api} onDone={() => setWizardOpen(false)} />
      ) : (
        <>
          <label className="calibration-field">
            <span className="calibration-field-label">
              <span>Region size</span>
              <span className="calibration-field-value">{sizePercent}%</span>
            </span>
            <input
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={0.01}
              value={controlRegion.width}
              aria-valuetext={`${sizePercent}%`}
              onChange={(e) => {
                const v = Number(e.target.value);
                setControlRegion({ width: v, height: v });
              }}
            />
            <span className="calibration-field-hint">Smaller = less arm movement to reach every edge.</span>
          </label>

          <label className="calibration-field">
            <span className="calibration-field-label">
              <span>Vertical position</span>
              <span className="calibration-field-value">{verticalLabel}</span>
            </span>
            <input
              type="range"
              min={CENTER_Y_MIN}
              max={CENTER_Y_MAX}
              step={0.01}
              value={controlRegion.centerY}
              aria-valuetext={verticalLabel}
              onChange={(e) => setControlRegion({ centerY: Number(e.target.value) })}
            />
            <span className="calibration-field-hint">Lower it for a relaxed, resting arm.</span>
          </label>

          <details className="calibration-preview-details">
            <summary>Preview region</summary>
            <div className="calibration-preview-frame">
              <div
                className="calibration-preview-region"
                style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
              />
            </div>
            <p className="calibration-preview-note">Schematic preview, not a live camera feed.</p>
          </details>

          <button type="button" className="calibration-panel-reset" onClick={() => setWizardOpen(true)}>
            Calibrate by hand
          </button>
          <button type="button" className="calibration-panel-reset" onClick={resetControlRegion}>
            Reset region to default
          </button>
        </>
      )}

      <hr className="calibration-divider" />

      <div className="calibration-field">
        <span className="calibration-field-label">
          <span>Interaction color</span>
        </span>
        <div className="calibration-swatches" role="group" aria-label="Interaction color presets">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              className="calibration-swatch"
              style={{ background: preset.hex }}
              aria-label={`${preset.name}, ${preset.hex}`}
              aria-pressed={interactionColor.toLowerCase() === preset.hex.toLowerCase()}
              onClick={() => setInteractionColor(preset.hex)}
            />
          ))}
          <label
            className="calibration-swatch calibration-swatch-custom"
            style={{ background: interactionColor }}
            data-active={isCustomColorActive}
          >
            <span className="calibration-visually-hidden">Custom color, {interactionColor}</span>
            <input
              type="color"
              value={interactionColor}
              onChange={(e) => setInteractionColor(e.target.value)}
              aria-label={`Custom interaction color, currently ${interactionColor}`}
            />
          </label>
        </div>
        <span className="calibration-field-hint">
          Colors the hand cursor, hover highlight, and dwell/select feedback everywhere.
        </span>
      </div>

      <button type="button" className="calibration-panel-reset" onClick={resetInteractionColor}>
        Reset color to default
      </button>

      <hr className="calibration-divider" />

      <div className="calibration-field">
        <span className="calibration-field-label">
          <span>Cursor shape</span>
        </span>
        <div className="calibration-shapes" role="group" aria-label="Cursor shape">
          {CURSOR_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="calibration-shape-option"
              aria-label={SHAPE_LABELS[shape]}
              aria-pressed={cursorShape === shape}
              onClick={() => setCursorShape(shape)}
            >
              <span className="calibration-shape-preview" data-shape={shape} />
              {SHAPE_LABELS[shape].replace(" (default)", "")}
            </button>
          ))}
        </div>
        <span className="calibration-field-hint">Shape of the fingertip cursor -- never affects where it points.</span>
      </div>

      <button type="button" className="calibration-panel-reset" onClick={resetCursorShape}>
        Reset shape to default
      </button>
    </div>
  );
}
