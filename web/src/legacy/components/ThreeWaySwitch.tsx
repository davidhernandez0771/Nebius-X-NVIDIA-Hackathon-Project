import type { KeyboardEvent } from "react";
import Icon, { type IconName } from "./Icon";

export type Choice = "organize" | "unknown" | "trash";

const choices: { value: Choice; label: string; icon: IconName }[] = [
  { value: "organize", label: "Organize", icon: "organize" },
  { value: "unknown", label: "Unknown", icon: "question" },
  { value: "trash", label: "Trash", icon: "trash" },
];

type Props = {
  value: Choice | null; // null = nothing chosen yet (still a proposal)
  onChange: (next: Choice) => void;
  label: string;
  disabled?: boolean;
};

// Per-item control: organize / unknown / trash. Radio-group semantics with
// arrow-key navigation.
export default function ThreeWaySwitch({ value, onChange, label, disabled }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    const current = choices.findIndex((c) => c.value === value);
    const next = choices[(current + step + choices.length) % choices.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-choice="${next.value}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div className="three-way" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {choices.map((c, i) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          data-choice={c.value}
          aria-checked={value === c.value}
          tabIndex={value === c.value || (value === null && i === 0) ? 0 : -1}
          disabled={disabled}
          className={`three-way-option${value === c.value ? " is-selected" : ""}`}
          onClick={() => onChange(c.value)}
        >
          <Icon name={c.icon} size={16} />
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}
