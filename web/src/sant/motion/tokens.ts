// Motion tokens for anime.js. tokens.css carries the same numbers as CSS custom properties;
// tokens.test.ts fails if the two drift apart. Spec: docs/design/motion.md §1.
import { cubicBezier } from "animejs";

export const DURATIONS = {
  "0": 0,
  "1": 80,
  "2": 140,
  "3": 200,
  "4": 320,
  story: 600,
  count: 1100,
  power: 1400,
} as const;

export const EASINGS = {
  out: [0.2, 0, 0, 1],
  in: [0.3, 0, 1, 1],
  move: [0.4, 0, 0.2, 1],
  emph: [0.05, 0.7, 0.1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const STAGGER = {
  list: 30,
  text: 70,
  sant: 140,
} as const;

export type EasingName = keyof typeof EASINGS;

/** The anime.js easing function for a token, e.g. `ease("out")`. */
export function ease(name: EasingName) {
  const [x1, y1, x2, y2] = EASINGS[name];
  return cubicBezier(x1, y1, x2, y2);
}
