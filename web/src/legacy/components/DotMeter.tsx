type Props = {
  value: number; // 0..1
  label: string;
  tone?: "warm" | "accent";
  dots?: number;
};

// A row of small round dots instead of a progress bar: filled --warm or
// --accent, the rest dim. For confidence scores and cost vs budget.
export default function DotMeter({ value, label, tone = "warm", dots = 14 }: Props) {
  const clamped = Math.min(1, Math.max(0, value));
  const filled = Math.round(clamped * dots);
  return (
    <div
      className={`dot-meter dot-meter--${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(clamped.toFixed(2))}
    >
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className={`dot${i < filled ? " is-filled" : ""}`} />
      ))}
    </div>
  );
}
