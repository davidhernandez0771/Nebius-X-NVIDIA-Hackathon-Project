import type { CSSProperties, ReactNode } from "react";
import { formatStat } from "../motion/format";
import { useMotion } from "../motion/MotionProvider";

/** A tracked thing. `box` is [x, y, width, height] as fractions of the frame (0–1), top-left origin. */
export type Detection = {
  id: string;
  label: string;
  score?: number;
  box: [number, number, number, number];
  tone?: "live" | "issue" | "info" | "neutral";
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;

/**
 * Detector-style overlay for Record: corner brackets, a label tab ("hand 0.97") and the box
 * centre in frame coordinates, over whatever is passed as children (the webcam). Fed by props, so
 * MediaPipe or the sim decides what is tracked. Boxes glide between frames for one short
 * duration; with reduced motion they jump. Assistive tech gets the list in words.
 */
export function TrackingHUD({
  detections,
  label,
  aspect = 16 / 9,
  readout,
  children,
}: {
  detections: Detection[];
  label: string;
  aspect?: number;
  readout?: ReactNode;
  children?: ReactNode;
}) {
  const { reduced } = useMotion();
  return (
    <figure className="sant-hud" aria-label={label} data-animate={!reduced} style={{ aspectRatio: String(aspect) }}>
      {children && <div className="sant-hud__media">{children}</div>}
      <div className="sant-hud__overlay" aria-hidden="true">
        <span className="sant-hud__reg sant-hud__reg--tl" />
        <span className="sant-hud__reg sant-hud__reg--tr" />
        <span className="sant-hud__reg sant-hud__reg--bl" />
        <span className="sant-hud__reg sant-hud__reg--br" />
        <span className="sant-hud__ruler" />
        <span className="sant-hud__readout">{readout ?? `${detections.length} tracked`}</span>
        {detections.map((d) => {
          const x = clamp01(d.box[0]);
          const y = clamp01(d.box[1]);
          const w = clamp01(d.box[0] + d.box[2]) - x;
          const h = clamp01(d.box[1] + d.box[3]) - y;
          return (
            <span
              key={d.id}
              className="sant-hud__box"
              data-tone={d.tone ?? "neutral"}
              style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) } as CSSProperties}
            >
              <span className="sant-hud__corner sant-hud__corner--tl" />
              <span className="sant-hud__corner sant-hud__corner--tr" />
              <span className="sant-hud__corner sant-hud__corner--bl" />
              <span className="sant-hud__corner sant-hud__corner--br" />
              <span className="sant-hud__tag">{d.score === undefined ? d.label : `${d.label} ${formatStat(d.score, 2)}`}</span>
              <span className="sant-hud__meta">
                x {formatStat(x + w / 2, 2)} y {formatStat(y + h / 2, 2)}
              </span>
            </span>
          );
        })}
      </div>
      <ul className="sant-sr-only" aria-label="Tracked">
        {detections.map((d) => (
          <li key={d.id}>{d.score === undefined ? d.label : `${d.label}, ${Math.round(d.score * 100)}% confidence`}</li>
        ))}
      </ul>
    </figure>
  );
}
