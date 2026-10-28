import type { ReactNode } from "react";

type Props = {
  tone?: "neutral" | "accent" | "warm" | "danger";
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
};

// Small, muted, one-line chip.
export default function StatusPill({ tone = "neutral", icon, title, children }: Props) {
  return (
    <span className={`status-pill status-pill--${tone}`} title={title}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
