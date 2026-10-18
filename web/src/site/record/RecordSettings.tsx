// The settings drawer on /record: the rarely used controls (control region, reach, Calibrate by
// hand, display, debug trace), out of the way of the rack. Same settings and the same rules as
// the old page's HandControlPanel (clampRegion, the depth gap, depthAuto off when set by hand), in
// a compact Volt slide-over that fits a 720 px tall window without scrolling.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { DEPTH_GAP, DEPTH_MAX, DEPTH_MIN, SIZE_MIN, STEP_TEXT } from "../../record/controlSettings";
import type { RecordSession } from "../../record/useRecordSession";
import { DEFAULT_TELEOP_CONTROL, REGION_SIZE_MAX, clampRegion, type TeleopControlSettings } from "../../record/teleop/controlRegion";
import { TRACE_SECONDS } from "../../record/teleop/debugTrace";

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(3));

function Slider({
  label,
  value,
  shown,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  shown: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="rc-field">
      <span className="rc-field__row">
        <span>{label}</span>
        <span className="rc-field__value">{shown}</span>
      </span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="rc-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rc-group" aria-label={title}>
      <h3 className="rc-group__title">{title}</h3>
      {children}
    </section>
  );
}

export function RecordSettings({ id, open, onClose, session }: { id: string; open: boolean; onClose: () => void; session: RecordSession }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const { settings, calibration, recentering, trace, streaming, pose } = session;
  const r = settings.region;
  const set = (patch: Partial<TeleopControlSettings>) => session.updateSettings({ ...settings, ...patch });
  const setRegion = (patch: Partial<typeof r>) => set({ region: clampRegion({ ...r, ...patch }) });
  const bottomPercent = Math.round((r.centerY + r.height / 2) * 100);
  const running = calibration && calibration.step !== "done" && calibration.step !== "failed";
  const tracked = pose?.msg.tracking_ok ?? false;
  const off = !settings.enabled;

  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);

  // Modal while open: Esc closes, and Tab cycles inside the drawer.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="rc-drawer" hidden={!open}>
      <div className="rc-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} id={id} className="rc-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
        <header className="rc-drawer__head">
          <h2 id={`${id}-title`} className="rc-drawer__title">
            settings
          </h2>
          <button ref={close} type="button" className="rc-btn rc-btn--icon" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </header>

        <Group title="control_region">
          <Check label="Use the control region" checked={settings.enabled} onChange={(v) => set({ enabled: v })} />
          <Slider
            label="Region size"
            value={r.width}
            shown={`${Math.round(r.width * 100)}%`}
            min={SIZE_MIN}
            max={REGION_SIZE_MAX}
            step={0.01}
            disabled={off}
            onChange={(v) => setRegion({ width: v, height: v })}
          />
          <Slider
            label="Vertical position"
            value={r.centerY}
            shown={`bottom ${bottomPercent}%`}
            min={r.height / 2}
            max={1 - r.height / 2}
            step={0.01}
            disabled={off}
            onChange={(v) => setRegion({ centerY: v })}
          />
          <p className="rc-hint">Smaller box = less movement · bottom edge = the table.</p>
        </Group>

        <Group title="reach">
          <Slider
            label="Depth far (palm width)"
            value={settings.depthFar}
            shown={settings.depthFar.toFixed(3)}
            min={DEPTH_MIN}
            max={DEPTH_MAX}
            step={0.005}
            disabled={off}
            onChange={(v) => set({ depthFar: Math.min(v, settings.depthNear - DEPTH_GAP), depthAuto: false })}
          />
          <Slider
            label="Depth near (palm width)"
            value={settings.depthNear}
            shown={settings.depthNear.toFixed(3)}
            min={DEPTH_MIN}
            max={DEPTH_MAX}
            step={0.005}
            disabled={off}
            onChange={(v) => set({ depthNear: Math.max(v, settings.depthFar + DEPTH_GAP), depthAuto: false })}
          />
          <p className="rc-hint">
            now: palm <span data-testid="reach-2d">{fmt(tracked ? pose?.msg.palm_width : null)}</span> · 3D{" "}
            <span data-testid="reach-3d">{fmt(tracked ? pose?.size3d : null)}</span> · uses {settings.reach3d ? "3D size" : "palm width"}
          </p>
          <Check label="3D reach (turning the hand changes reach less)" checked={settings.reach3d} disabled={off} onChange={(v) => set({ reach3d: v })} />
          <div className="rc-line">
            <button type="button" className="rc-btn" onClick={session.startRecenter} disabled={!streaming}>
              Re-center reach
            </button>
            <span className="rc-hint" role={recentering ? "status" : undefined}>
              {recentering ? "Hold still at a natural distance (~1 s)." : settings.depthAuto ? "auto-centers at start" : "calibrated range"}
            </span>
          </div>
        </Group>

        <Group title="calibrate">
          {running ? (
            <div className="rc-calib" role="status">
              <p className="rc-hint">{STEP_TEXT[calibration.step]}</p>
              <div className="rc-line">
                <progress max={1} value={calibration.progress} aria-label="Calibration step progress" />
                <button type="button" className="rc-btn" onClick={session.cancelCalibration}>
                  Cancel calibration
                </button>
              </div>
            </div>
          ) : (
            <div className="rc-line">
              <button type="button" className="rc-btn" onClick={session.startCalibration} disabled={!streaming}>
                Calibrate by hand
              </button>
              <span className="rc-hint">{streaming ? "box, then near and far holds" : "start the camera first"}</span>
            </div>
          )}
          {calibration?.step === "done" && (
            <p className="rc-hint" role="status">
              Calibrated: region {Math.round(r.width * 100)}%, bottom {bottomPercent}%, palm {settings.depthFar.toFixed(3)}–{settings.depthNear.toFixed(3)}.
            </p>
          )}
          {calibration?.step === "failed" && (
            <p className="rc-hint rc-hint--issue" role="alert">
              {calibration.error}
            </p>
          )}
        </Group>

        <Group title="display">
          <Check label="Hand art over the camera (display only)" checked={settings.showHandArt} onChange={(v) => set({ showHandArt: v })} />
          <div className="rc-pair">
            <Check label="Invert up-down" checked={settings.invertY} onChange={(v) => set({ invertY: v })} />
            <Check label="Invert left-right" checked={settings.invertX} onChange={(v) => set({ invertX: v })} />
          </div>
        </Group>

        <footer className="rc-drawer__foot">
          {trace?.state === "recording" ? (
            <span className="rc-line" role="status">
              <progress max={1} value={trace.progress} aria-label="Debug trace progress" />
              <span className="rc-hint">recording trace…</span>
            </span>
          ) : (
            <button type="button" className="rc-btn" onClick={session.startTrace} disabled={!streaming}>
              Debug trace ({TRACE_SECONDS} s)
            </button>
          )}
          <button type="button" className="rc-btn rc-btn--quiet" onClick={() => session.updateSettings(DEFAULT_TELEOP_CONTROL)}>
            Reset to defaults
          </button>
          {trace?.state === "done" && (
            <p className="rc-hint rc-drawer__download" role="status">
              <a href={trace.url} download={trace.name}>
                Download debug trace
              </a>{" "}
              ({trace.frames} frames) → Downloads/{trace.name}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}
