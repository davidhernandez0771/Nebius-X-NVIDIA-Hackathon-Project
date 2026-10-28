import type { CSSProperties } from "react";
import { LOGO_SYMBOL } from "./logoSymbol";

/**
 * The logo: the SANT mark (logoSymbol.ts, the open-corner tesseract) with the "SANT" wordmark set wide
 * beside it, the lockup of the logo sheet. Its parts light in sequence (CSS, --sant-stagger-sant apart);
 * the inner cube rests in the accent, the rest in ink. Pass `src` to show a finished SVG file instead.
 */
export function Logo({
  lit = "sequence",
  src,
  size = "md",
  wordmark = true,
}: {
  lit?: "sequence" | "all" | "none";
  src?: string;
  size?: "sm" | "md" | "lg";
  wordmark?: boolean;
}) {
  if (src) return <img className={`sant-logo-img sant-logo--${size}`} src={src} alt="SANT" />;
  const stroked = LOGO_SYMBOL.stroke > 0;
  return (
    <span className={`sant-logo sant-logo--${size}`} role="img" aria-label="SANT" data-lit={lit} data-word={wordmark}>
      <svg
        className="sant-logo__symbol"
        viewBox={LOGO_SYMBOL.viewBox}
        aria-hidden="true"
        focusable="false"
        fill={stroked ? "none" : undefined}
        strokeWidth={stroked ? LOGO_SYMBOL.stroke : undefined}
        strokeLinecap={stroked ? "round" : undefined}
        strokeLinejoin={stroked ? "round" : undefined}
      >
        {LOGO_SYMBOL.units.map((d, i) => (
          <path key={i} className="sant-logo__unit" d={d} data-part={LOGO_SYMBOL.accent.includes(i) ? "accent" : "ink"} style={{ "--i": i } as CSSProperties} />
        ))}
      </svg>
      {wordmark && (
        <span className="sant-logo__word" aria-hidden="true">
          SANT
        </span>
      )}
    </span>
  );
}
