import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DWELL_ELIGIBLE_ATTR } from "../hand/contracts";

type Props = {
  icon: ReactNode;
  label: string; // accessible name + tooltip (tiles are icon-only)
  active?: boolean;
  to?: string;
  onClick?: () => void;
  // Renders as an inert, dimmed button instead of a Link -- for a nav
  // destination that's reachable in principle but has nothing to do yet
  // (e.g. no room selected). Stays in place rather than disappearing, so the
  // rail doesn't reflow. `disabled`/`aria-disabled` here is also exactly
  // what useHandPointer's dwell-click logic already checks before
  // dwell-activating a target, so this is skipped by hand tracking for free.
  disabled?: boolean;
  disabledReason?: string; // shown as the tooltip in place of `label` when disabled
};

// 56-64px rounded square. Active: filled accent with a dark icon.
// Inactive: dark glass with a light outline icon.
export default function IconTile({ icon, label, active = false, to, onClick, disabled = false, disabledReason }: Props) {
  const className = `icon-tile${active ? " is-active" : ""}${disabled ? " icon-tile--disabled" : ""}`;
  if (disabled) {
    return (
      <button
        type="button"
        className={className}
        aria-label={label}
        title={disabledReason ?? label}
        aria-disabled="true"
        disabled
      >
        {icon}
      </button>
    );
  }
  if (to) {
    // Dwell (hover) activation is only ever safe on real navigation links --
    // IconTile's only actual usage today is DashboardShell's sidebar nav
    // (checked: no other caller in the app), which is exactly this branch.
    // The onClick/button branch below (used for non-navigation actions, if
    // ever) deliberately does NOT get this marker.
    return (
      <Link
        to={to}
        className={className}
        aria-label={label}
        title={label}
        aria-current={active ? "page" : undefined}
        {...{ [DWELL_ELIGIBLE_ATTR]: "true" }}
      >
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
