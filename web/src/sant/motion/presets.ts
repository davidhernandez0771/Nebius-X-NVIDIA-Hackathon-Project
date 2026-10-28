// anime.js presets for SANT's orchestrated moments (docs/design/motion.md §5). Each takes
// `reduced` and returns a cleanup function; when reduced it sets the end state at once.
import { animate } from "animejs";
import { DURATIONS, ease } from "./tokens";

export function countUp({
  from = 0,
  to,
  duration = DURATIONS.count,
  reduced,
  onUpdate,
  onComplete,
}: {
  from?: number;
  to: number;
  duration?: number;
  reduced: boolean;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}): () => void {
  if (reduced) {
    onUpdate(to);
    onComplete?.();
    return () => {};
  }
  const state = { v: from };
  // Ease-out only: an overshooting curve would show a number nobody measured.
  const anim = animate(state, {
    v: to,
    duration,
    ease: ease("out"),
    onUpdate: () => onUpdate(Math.min(state.v, to)),
    onComplete: () => {
      onUpdate(to);
      onComplete?.();
    },
  });
  return () => {
    anim.pause();
  };
}
