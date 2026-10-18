import type { CSSProperties } from "react";

const UNITS = ["S", "A", "N", "T"] as const;

/**
 * Placeholder for the user's logo: four units that light in sequence (CSS, --sant-stagger-sant
 * apart). Pass `src` to swap in the real SVG; it should keep four groups (#s #a #n #t) so the
 * sequence still works.
 */
export function Logo({ lit = "sequence", src, size = "md" }: { lit?: "sequence" | "all" | "none"; src?: string; size?: "sm" | "md" | "lg" }) {
  if (src) return <img className={`sant-logo-img sant-logo--${size}`} src={src} alt="SANT" />;
  return (
    <span className={`sant-logo sant-logo--${size}`} role="img" aria-label="SANT" data-lit={lit}>
      {UNITS.map((u, i) => (
        <span key={u} aria-hidden="true" className="sant-logo__unit" style={{ "--i": i } as CSSProperties}>
          {u}
        </span>
      ))}
    </span>
  );
}
