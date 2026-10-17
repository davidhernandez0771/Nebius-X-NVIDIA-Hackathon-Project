// The story → app "power on" as a timed plan (docs/design/motion.md §4). PowerOn.tsx plays it;
// keeping the timing pure makes it testable without a browser.
import { DURATIONS, STAGGER } from "./tokens";

export type PowerOnStep =
  | { phase: "cover"; at: number; duration: number }
  | { phase: "light"; at: number; unit: 0 | 1 | 2 | 3 }
  | { phase: "navigate"; at: number }
  | { phase: "reveal"; at: number; duration: number }
  | { phase: "done"; at: number };

const COVER = 420;
const FIRST_LIGHT = 160;
const REVEAL = 180;

export function powerOnPlan(reduced: boolean): PowerOnStep[] {
  if (reduced) return [{ phase: "navigate", at: 0 }, { phase: "done", at: 0 }];
  const steps: PowerOnStep[] = [
    { phase: "cover", at: 0, duration: COVER },
    { phase: "navigate", at: COVER },
    { phase: "reveal", at: DURATIONS.power - REVEAL, duration: REVEAL },
    { phase: "done", at: DURATIONS.power },
  ];
  for (const unit of [0, 1, 2, 3] as const) steps.push({ phase: "light", at: FIRST_LIGHT + unit * STAGGER.sant, unit });
  // Stable sort: at equal times the order above wins.
  return steps.sort((a, b) => a.at - b.at);
}
