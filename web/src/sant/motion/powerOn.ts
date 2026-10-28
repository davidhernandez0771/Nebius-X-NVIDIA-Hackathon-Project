// The story ↔ app crossing ("power on") as a timed plan (docs/design/motion.md §4). PowerOn.tsx plays
// it in either direction; keeping the timing pure makes it testable without a browser.
import { DURATIONS, STAGGER } from "./tokens";

export type PowerOnStep =
  | { phase: "cover"; at: number; duration: number }
  | { phase: "gather"; at: number; duration: number; stagger: number }
  | { phase: "light"; at: number; unit: 0 | 1 | 2 | 3 }
  | { phase: "navigate"; at: number }
  | { phase: "reveal"; at: number; duration: number }
  | { phase: "done"; at: number };

// The page dissolves into a dot matrix of the other mode's colour (COVER), the route changes under
// it, dust gathers into the logo symbol, then the cover powers off into shrinking dots (REVEAL).
// Sprint 9 feedback asked for ~600–900 ms in all, so the whole thing is DURATIONS.power (860).
const COVER = 340;
// Dust starts gathering while the cover grows; unit u lands, and lights, at GATHER_AT + GATHER + u × stagger.
const GATHER_AT = 80;
const GATHER = 260;
const REVEAL = 300;

export function powerOnPlan(reduced: boolean): PowerOnStep[] {
  if (reduced) return [{ phase: "navigate", at: 0 }, { phase: "done", at: 0 }];
  const steps: PowerOnStep[] = [
    { phase: "cover", at: 0, duration: COVER },
    { phase: "gather", at: GATHER_AT, duration: GATHER, stagger: STAGGER.cross },
    { phase: "navigate", at: COVER },
    { phase: "reveal", at: DURATIONS.power - REVEAL, duration: REVEAL },
    { phase: "done", at: DURATIONS.power },
  ];
  for (const unit of [0, 1, 2, 3] as const) steps.push({ phase: "light", at: GATHER_AT + GATHER + unit * STAGGER.cross, unit });
  // Stable sort: at equal times the order above wins.
  return steps.sort((a, b) => a.at - b.at);
}
