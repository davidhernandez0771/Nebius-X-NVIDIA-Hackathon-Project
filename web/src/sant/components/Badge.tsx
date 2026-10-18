import type { ReactNode } from "react";

export type Tone = "neutral" | "live" | "issue" | "info";

/** Text is always present: colour is never the only signal. */
export function Badge({ tone = "neutral", dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`sant-badge sant-badge--${tone}`}>
      {dot && <span className="sant-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
