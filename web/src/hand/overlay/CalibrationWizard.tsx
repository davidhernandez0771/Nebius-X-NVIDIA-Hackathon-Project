import { useEffect, useRef, useState } from "react";
import type { ControlRegion, HandPointerApi } from "../contracts";

type Props = {
  api: HandPointerApi;
  onDone: () => void; // called on commit, cancel, AND the panel's own close -- always leaves the region in a sane state
};

type Phase = "intro" | "reach" | "no-hand" | "confirm";

// Kept in sync with CalibrationPanel.tsx's own SIZE_MIN/MAX and
// CENTER_Y_MIN/MAX slider ranges -- the wizard computes the same two values
// (uniform size, vertical center) those sliders set, just measured from real
// reach instead of dragged by feel. Not imported from there to avoid coupling
// two otherwise-independent files over two literals.
const SIZE_MIN = 0.2;
const SIZE_MAX = 0.9;
const CENTER_Y_MIN = 0.3;
const CENTER_Y_MAX = 0.75;

// Generous region held during the reach step so the existing clamp in
// mapRegion() doesn't cut off genuine reach before it can be measured --
// there is no raw (pre-region-mapped) landmark position exposed by the
// public contract, so this is what lets `cursor` (the region-mapped,
// viewport-pixel point HandPointerApi already exposes) stand in for it: as
// long as real reach stays inside this region, inverting the same mapping
// the region applied recovers the raw position that produced it.
const REACH_REGION: ControlRegion = { centerX: 0.5, centerY: 0.5, width: SIZE_MAX, height: SIZE_MAX };

const REACH_DURATION_MS = 3000;
const MIN_VALID_SAMPLES = 10; // below this, treat it as "never saw a hand", not "measured a tiny region"
// Comfortable reach is measured at its extremes; pad outward so the very
// edge of that reach isn't also the literal edge of the region (nothing left
// past it to relax into).
const PADDING_FACTOR = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Inverse of GestureProcessor's mapRegion() for REACH_REGION specifically:
// recovers the raw, region-independent point that produced a given viewport
// pixel, assuming REACH_REGION was in effect (i.e. the clamp never engaged
// -- true as long as reach stayed inside REACH_REGION's generous bounds).
function unmapRegionPoint(pixelX: number, pixelY: number): { rawX: number; rawY: number } {
  const mirroredX = pixelX / window.innerWidth;
  const clampedX = 1 - mirroredX;
  const rawX = clampedX * REACH_REGION.width + (REACH_REGION.centerX - REACH_REGION.width / 2);

  const clampedY = pixelY / window.innerHeight;
  const rawY = clampedY * REACH_REGION.height + (REACH_REGION.centerY - REACH_REGION.height / 2);

  return { rawX, rawY };
}

/**
 * "Calibrate by hand": a short guided routine that measures the user's own
 * comfortable reach instead of asking them to drag abstract sliders against
 * a schematic (non-live) preview. Reach step samples the already-exposed
 * `cursor` field (see unmapRegionPoint's doc above for why that's enough
 * without a contract change), derives a region from the observed extremes,
 * and hands it to `setControlRegion` -- the same API the manual sliders use.
 *
 * Mounted by CalibrationPanel in place of its normal sliders while active;
 * the sliders remain available afterward as a manual-override fallback.
 */
export function CalibrationWizard({ api, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(REACH_DURATION_MS / 1000));
  const [derived, setDerived] = useState<{ width: number; centerY: number } | null>(null);

  // Read inside rAF callbacks without retriggering the sampling effect on
  // every render (`api` is a fresh object each render from useHandPointer).
  const apiRef = useRef(api);
  apiRef.current = api;

  // Snapshot of whatever region was active before the wizard touched
  // anything, restored on cancel/close-without-committing.
  const previousRegionRef = useRef<ControlRegion | null>(null);

  useEffect(() => {
    if (phase !== "reach") return;

    previousRegionRef.current = apiRef.current.controlRegion;
    apiRef.current.setControlRegion(REACH_REGION);

    let rawXMin = Infinity;
    let rawXMax = -Infinity;
    let rawYMin = Infinity;
    let rawYMax = -Infinity;
    let validSamples = 0;
    let rafId: number;
    const startedAt = performance.now();

    function tick(now: number) {
      const cursor = apiRef.current.cursor;
      if (cursor) {
        const { rawX, rawY } = unmapRegionPoint(cursor.x, cursor.y);
        rawXMin = Math.min(rawXMin, rawX);
        rawXMax = Math.max(rawXMax, rawX);
        rawYMin = Math.min(rawYMin, rawY);
        rawYMax = Math.max(rawYMax, rawY);
        validSamples += 1;
      }

      const elapsed = now - startedAt;
      const remaining = Math.max(0, REACH_DURATION_MS - elapsed);
      setSecondsLeft(Math.ceil(remaining / 1000));

      if (elapsed >= REACH_DURATION_MS) {
        if (validSamples < MIN_VALID_SAMPLES) {
          setPhase("no-hand");
          return;
        }
        const horizontalHalfSpan = Math.max(Math.abs(rawXMax - 0.5), Math.abs(rawXMin - 0.5));
        const verticalHalfSpan = (rawYMax - rawYMin) / 2;
        const size = clamp(Math.max(horizontalHalfSpan, verticalHalfSpan) * 2 * PADDING_FACTOR, SIZE_MIN, SIZE_MAX);
        const centerY = clamp((rawYMin + rawYMax) / 2, CENTER_Y_MIN, CENTER_Y_MAX);
        setDerived({ width: size, centerY });
        setPhase("confirm");
        return;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [phase]);

  function startReach() {
    setSecondsLeft(Math.ceil(REACH_DURATION_MS / 1000));
    setPhase("reach");
  }

  function cancel() {
    if (previousRegionRef.current) apiRef.current.setControlRegion(previousRegionRef.current);
    onDone();
  }

  function commit() {
    if (derived) apiRef.current.setControlRegion({ width: derived.width, height: derived.width, centerY: derived.centerY });
    onDone();
  }

  if (phase === "intro") {
    return (
      <div className="calibration-wizard-step">
        <p className="calibration-instructions">
          Hold your hand up and reach comfortably toward the edges of your natural range for a few seconds -- up,
          down, left and right. This measures your actual reach instead of a slider guess.
        </p>
        {api.status !== "tracking" ? (
          <p className="calibration-field-hint">Turn on hand control and make sure your hand is visible first.</p>
        ) : (
          <button type="button" className="calibration-panel-reset" onClick={startReach}>
            Start
          </button>
        )}
        <button type="button" className="calibration-panel-reset" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === "reach") {
    return (
      <div className="calibration-wizard-step">
        <p className="calibration-instructions">Reach toward the edges of your comfortable range now...</p>
        <div className="calibration-wizard-progress">
          <div className="calibration-wizard-progress-fill" style={{ width: `${100 - (secondsLeft / Math.ceil(REACH_DURATION_MS / 1000)) * 100}%` }} />
        </div>
        <p className="calibration-field-hint">{secondsLeft}s</p>
        <button type="button" className="calibration-panel-reset" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === "no-hand") {
    return (
      <div className="calibration-wizard-step">
        <p className="calibration-instructions">Couldn't see your hand clearly during that. Make sure it's in view and try again.</p>
        <button type="button" className="calibration-panel-reset" onClick={startReach}>
          Try again
        </button>
        <button type="button" className="calibration-panel-reset" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  // phase === "confirm"
  const region = derived!;
  const left = Math.max(0, 0.5 - region.width / 2) * 100;
  const top = Math.max(0, region.centerY - region.width / 2) * 100;
  const size = Math.min(region.width, 1 - left / 100) * 100;
  return (
    <div className="calibration-wizard-step">
      <p className="calibration-instructions">Here's the region measured from your reach.</p>
      <div className="calibration-preview-frame">
        <div className="calibration-preview-region" style={{ left: `${left}%`, top: `${top}%`, width: `${size}%`, height: `${size}%` }} />
      </div>
      <button type="button" className="calibration-panel-reset" onClick={commit}>
        Use this
      </button>
      <button type="button" className="calibration-panel-reset" onClick={startReach}>
        Redo
      </button>
      <button type="button" className="calibration-panel-reset" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}
