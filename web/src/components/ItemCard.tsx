import type { ReactNode } from "react";
import GlassCard from "./GlassCard";
import Icon, { type IconName } from "./Icon";
import StatusPill from "./StatusPill";

// What the app knows about the thing. Only "confirmed" looks real:
//   proposed  -> the AI suggested it; nothing has been decided (dashed, dimmed)
//   unknown   -> the user is unsure; still needs attention (dashed, amber)
//   confirmed -> the user decided; solid glass with the accent
//   trash     -> soft state: muted, with an Undo, never a hard-delete look
export type ItemState = "proposed" | "unknown" | "confirmed" | "trash";

const pill = {
  proposed: { tone: "warm", text: "Proposed" },
  unknown: { tone: "warm", text: "Unknown" },
  confirmed: { tone: "accent", text: "Confirmed" },
  trash: { tone: "danger", text: "In trash" },
} as const;

const variant = {
  proposed: "provisional",
  unknown: "provisional",
  confirmed: "solid",
  trash: "muted",
} as const;

type Props = {
  name: string;
  subline?: string;
  state: ItemState;
  icon?: IconName;
  onUndo?: () => void; // shown when the item is in trash
  children?: ReactNode; // the control(s)
};

export default function ItemCard({ name, subline, state, icon = "box", onUndo, children }: Props) {
  const { tone, text } = pill[state];
  return (
    <GlassCard as="li" variant={variant[state]} className={`item-card item-card--${state}`}>
      <div className="item-card-head">
        <span className="item-card-thumb">
          <Icon name={icon} size={24} />
        </span>
        <div className="item-card-text">
          <h3 className="item-card-name">{name}</h3>
          {subline && <p className="muted small">{subline}</p>}
        </div>
        <StatusPill tone={tone}>{text}</StatusPill>
      </div>
      {state === "trash" && onUndo && (
        <button type="button" className="undo-button" onClick={onUndo}>
          <Icon name="undo" size={16} /> Undo
        </button>
      )}
      {children && <div className="item-card-controls">{children}</div>}
    </GlassCard>
  );
}
