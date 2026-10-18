import type { CSSProperties } from "react";
import { SANT_STEPS, unitState } from "./steps";

/**
 * The S·A·N·T rail: the app's signature. Units light in sequence on mount (CSS, staggered by
 * --sant-stagger-sant); with motion reduced they are simply lit.
 */
export function StepRail({ active, compact = false }: { active: number | null; compact?: boolean }) {
  return (
    <ol className={`sant-rail${compact ? " sant-rail--compact" : ""}`} aria-label="SANT steps">
      {SANT_STEPS.map((step, i) => {
        const state = unitState(i, active);
        return (
          <li
            key={step.letter}
            className="sant-rail__unit"
            data-state={state}
            aria-current={state === "active" ? "step" : undefined}
            title={step.hint}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="sant-rail__letter">{step.letter}</span>
            <span className="sant-rail__name">{step.name}</span>
          </li>
        );
      })}
    </ol>
  );
}
