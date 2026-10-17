// The reset gesture's ring: fills while Victory (✌) is held, then shows that the reset was sent.
//
// Display only: it renders a ResetGestureStatus from teleop/resetGesture.ts and never decides
// anything itself. T4's Record wiring owns the detector, the reset_scene control and placement.
//
// Colors follow pm.css's meanings (tokens.css only): the hold is the user's request, so it fills
// in --warm; once it fires, code acts on it, so the ring turns --accent. Styles are inline because
// pm.css belongs to the Record page's owner; nothing here restyles the page.
//
// Motion: the arc follows the real hold time frame by frame, so it is state, not decoration.
// With motion on, a 90 ms transition smooths frame steps and one pulse marks the fire. With
// prefers-reduced-motion (or reducedMotion), neither: the ring jumps to each state.

import { useEffect, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "../../three/capability";
import type { ResetGestureCancelReason, ResetGestureStatus } from "../../teleop/resetGesture";

const CANCEL_TEXT: Record<ResetGestureCancelReason, string> = {
  gripper: "Reset cancelled: hand closed",
  moved: "Reset cancelled: hand moved",
  dropped: "Reset cancelled: sign lost",
  "low-score": "Reset cancelled: sign unclear",
};
const CANCEL_SHOWN_MS = 2000;
// U+FE0E asks for the text (monochrome) form, so the glyph takes the state color instead of a
// full-color emoji; the symbol fonts are the ones that have that form on Windows and Linux.
export const VICTORY_GLYPH = "✌︎";
const GLYPH_FONT = '"Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Symbols", var(--font)';

export interface ResetGestureRingProps {
  /** The detector's latest status; null before any frame. */
  status: ResetGestureStatus | null;
  /** Ring diameter in CSS px. */
  size?: number;
  /** Show the "how to" hint while idle. */
  showHint?: boolean;
  /** Overrides prefers-reduced-motion (tests, or an "Effects off" setting). */
  reducedMotion?: boolean;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export default function ResetGestureRing({ status, size = 40, showHint = true, reducedMotion }: ResetGestureRingProps) {
  const still = reducedMotion ?? prefersReducedMotion();
  const phase = status?.phase ?? "idle";
  const [cancelReason, setCancelReason] = useState<ResetGestureCancelReason | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (status?.event === "cancel" && status.cancelReason) setCancelReason(status.cancelReason);
    if (status?.event === "start") setCancelReason(null);
    if (status?.event === "fire") setPulseKey((k) => k + 1);
  }, [status]);

  useEffect(() => {
    if (!cancelReason) return;
    const id = window.setTimeout(() => setCancelReason(null), CANCEL_SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [cancelReason]);

  const sent = phase === "cooldown";
  const fill = sent ? 1 : phase === "holding" ? clamp01(status?.progress ?? 0) : 0;
  const label = sent
    ? "Reset sent"
    : phase === "holding"
      ? "Keep holding to reset"
      : cancelReason
        ? CANCEL_TEXT[cancelReason]
        : showHint
          ? `Hold ${VICTORY_GLYPH} for 1.5 s to reset the scene`
          : "";

  const stroke = 3;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const arcStyle: CSSProperties = still ? {} : { transition: "stroke-dashoffset 90ms linear, stroke 160ms ease-out" };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontFamily: "var(--font)" }}>
      <div
        role="progressbar"
        aria-label="Reset gesture"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        style={{ position: "relative", width: size, height: size, flex: "none" }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ display: "block" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-border)" strokeWidth={stroke} />
          <circle
            data-part="arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={sent ? "var(--accent)" : "var(--warm)"}
            strokeWidth={stroke}
            strokeLinecap={fill > 0 && fill < 1 ? "round" : "butt"}
            strokeDasharray={length}
            strokeDashoffset={length * (1 - fill)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={arcStyle}
          />
          {sent && !still && (
            <circle
              key={pulseKey}
              data-part="pulse"
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1}
            >
              <animate attributeName="r" from={r} to={size / 2} dur="420ms" fill="freeze" />
              <animate attributeName="opacity" from="0.8" to="0" dur="420ms" fill="freeze" />
            </circle>
          )}
        </svg>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontFamily: GLYPH_FONT,
            fontVariantEmoji: "text",
            fontSize: size * 0.42,
            lineHeight: 1,
            color: sent ? "var(--accent)" : phase === "holding" ? "var(--warm)" : "var(--text-muted)",
          }}
        >
          {VICTORY_GLYPH}
        </span>
      </div>
      <span
        aria-live="polite"
        style={{ fontSize: "var(--fs-sm)", color: phase === "idle" && !cancelReason ? "var(--text-muted)" : "var(--text)" }}
      >
        {label}
      </span>
    </div>
  );
}
