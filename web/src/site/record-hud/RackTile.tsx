import type { ReactNode } from "react";
import { formatStat } from "../../sant/motion/format";
import "./record-hud.css";

/**
 * One tile of the instrument rack: a snake_case channel name, its unit top right, then the
 * instrument. `selected` outlines it in the signal colour, for the channel that just changed state
 * (the grip closing). `span` takes two columns (wide) or two rows (cam).
 */
export function RackTile({
  label,
  unit,
  selected = false,
  span,
  className = "",
  children,
}: {
  label: string;
  unit?: string;
  selected?: boolean;
  span?: "wide" | "cam";
  className?: string;
  children: ReactNode;
}) {
  const cls = ["rh-tile", span && `rh-tile--${span}`, className].filter(Boolean).join(" ");
  return (
    <section className={cls} data-selected={selected || undefined} aria-label={label}>
      <header className="rh-tile__hd">
        <span className="rh-tile__label">{label}</span>
        {unit && <span className="rh-tile__unit">{unit}</span>}
      </header>
      {children}
    </section>
  );
}

/** A number for a readout: fixed decimals, a true minus sign, and a dash when there is none. */
export function readout(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatStat(value, decimals).replace("-", "−");
}

/** A small channel: one value in the mid size, or any short state passed as children. */
export function ChannelTile({
  label,
  unit,
  value,
  decimals = 2,
  children,
}: {
  label: string;
  unit?: string;
  value?: number | null;
  decimals?: number;
  children?: ReactNode;
}) {
  return (
    <RackTile label={label} unit={unit} className="rh-tile--channel">
      {children ?? <p className="rh-mid">{readout(value, decimals)}</p>}
    </RackTile>
  );
}
