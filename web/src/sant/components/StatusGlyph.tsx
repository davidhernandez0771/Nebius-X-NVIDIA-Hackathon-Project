import { useMotion } from "../motion/MotionProvider";

export type GlyphState = "recorded" | "diagnosed" | "repaired" | "verified" | "failed" | "blocked";

/**
 * The pipeline's states as rounded-square marks. Each has its own shape and its own name, so
 * colour is never the only signal. Tones follow the palette: teal is good, amber is a repair,
 * violet is the diagnosis (Nemotron's series colour), red is an error.
 */
export const GLYPH_STATES: Record<GlyphState, { label: string; busy: string; tone: "neutral" | "info" | "issue" | "live" | "danger" | "muted"; mark: string }> = {
  // A record dot.
  recorded: { label: "Recorded", busy: "Recording", tone: "neutral", mark: "M12 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6" },
  // Three lines of a report, the last one short.
  diagnosed: { label: "Diagnosed", busy: "Diagnosing", tone: "info", mark: "M7.5 8.5h9M7.5 12h9M7.5 15.5h5" },
  // A path with a kink taken out: the repaired movement.
  repaired: { label: "Repaired", busy: "Repairing", tone: "issue", mark: "M6.5 15.5c2-4 3.5-6 5.5-3.5s3.5 .5 5.5-3.5" },
  verified: { label: "Verified", busy: "Verifying", tone: "live", mark: "M7.5 12.3l3 3l6-6.6" },
  failed: { label: "Failed", busy: "Failed", tone: "danger", mark: "M8.5 8.5l7 7M15.5 8.5l-7 7" },
  blocked: { label: "Blocked", busy: "Blocked", tone: "muted", mark: "M7.5 12h9" },
};

/**
 * One status mark. A new state redraws its mark (the stroke draws in, the square fills); `busy`
 * runs a slow dash around the edge for a step still in progress. Still with reduced motion.
 */
export function StatusGlyph({ state, busy = false, showLabel = false, label }: { state: GlyphState; busy?: boolean; showLabel?: boolean; label?: string }) {
  const { reduced } = useMotion();
  const meta = GLYPH_STATES[state];
  const name = label ?? (busy ? meta.busy : meta.label);
  return (
    <span
      className="sant-glyph"
      data-state={state}
      data-tone={meta.tone}
      data-busy={busy}
      data-animate={!reduced}
      role={showLabel ? undefined : "img"}
      aria-label={showLabel ? undefined : name}
    >
      <svg key={`${state}-${busy}`} className="sant-glyph__svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <rect className="sant-glyph__fill" x="2" y="2" width="20" height="20" rx="6" />
        <rect className="sant-glyph__edge" x="2" y="2" width="20" height="20" rx="6" pathLength={100} strokeDasharray={state === "blocked" ? "4 4" : undefined} />
        <path className="sant-glyph__mark" d={meta.mark} pathLength={1} />
      </svg>
      {showLabel && <span className="sant-glyph__label">{name}</span>}
    </span>
  );
}
