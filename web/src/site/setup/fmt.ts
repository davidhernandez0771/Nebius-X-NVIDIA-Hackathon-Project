import type { PartJoint } from "./types";

const MINUS = "−";
const signed = (n: number) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `${n}`);

export function jointRange(j: Pick<PartJoint, "type" | "limits">): string {
  if (j.type === "fixed" || j.type === "continuous") return j.type;
  if (!j.limits) return "no limits";
  const { lower, upper } = j.limits;
  if (j.type === "prismatic") {
    const lo = Math.round(lower * 1000);
    const hi = Math.round(upper * 1000);
    // an en dash after a minus sign reads as a range of negatives, so a negative lower bound gets "to"
    return lo < 0 ? `${signed(lo)} to ${hi} mm` : `${lo}–${hi} mm`;
  }
  const lo = Math.round((lower * 180) / Math.PI);
  const hi = Math.round((upper * 180) / Math.PI);
  return lo === -hi ? `±${hi}°` : `${signed(lo)}° to ${signed(hi)}°`;
}

export const pct = (share: number) => `${Math.round(share * 100)}%`;

export const metres = (m: number) => `${m.toFixed(2)} m`;
