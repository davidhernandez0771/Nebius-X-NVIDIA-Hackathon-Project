import { createElement, type ReactNode } from "react";

// How a card reads. The AI only proposes, so "provisional" (dashed, dimmed)
// is the look for anything not yet confirmed; "solid" is confirmed.
export type CardVariant = "glass" | "solid" | "provisional" | "muted";

type Props = {
  as?: "div" | "section" | "article" | "li";
  variant?: CardVariant;
  className?: string;
  children: ReactNode;
};

export default function GlassCard({ as = "div", variant = "glass", className = "", children }: Props) {
  return createElement(as, { className: `glass-card glass-card--${variant} ${className}`.trim() }, children);
}
