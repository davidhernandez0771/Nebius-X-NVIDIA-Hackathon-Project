import type { CSSProperties } from "react";
import { LOGO_SYMBOL } from "./logoSymbol";

/**
 * The logo: the SANT symbol (logoSymbol.ts, a placeholder until the user's drawing lands), with the
 * "SANT" wordmark beside it. Its parts light in sequence (CSS, --sant-stagger-sant apart); part 0, the
 * original, rests in the accent. Pass `src` to show a finished SVG file instead.
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
  return (
    <span className={`sant-logo sant-logo--${size}`} role="img" aria-label="SANT" data-lit={lit}>
      <svg className="sant-logo__symbol" viewBox={LOGO_SYMBOL.viewBox} aria-hidden="true" focusable="false">
        {LOGO_SYMBOL.units.map((d, i) => (
          <path key={i} className="sant-logo__unit" d={d} data-part={i === 0 ? "original" : "copy"} style={{ "--i": i } as CSSProperties} />
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
