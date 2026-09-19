import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  icon: ReactNode;
  label: string; // accessible name + tooltip (tiles are icon-only)
  active?: boolean;
  to?: string;
  onClick?: () => void;
};

// 56-64px rounded square. Active: filled accent with a dark icon.
// Inactive: dark glass with a light outline icon.
export default function IconTile({ icon, label, active = false, to, onClick }: Props) {
  const className = `icon-tile${active ? " is-active" : ""}`;
  if (to) {
    return (
      <Link to={to} className={className} aria-label={label} title={label} aria-current={active ? "page" : undefined}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" className={className} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
      {icon}
    </button>
  );
}
