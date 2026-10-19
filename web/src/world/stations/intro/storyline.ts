// The intro's 3D under the breaks (ui/wipe.ts). The intro's dwell is as long as the breaks, so the
// camera's turn round the logo and the particles' flight to the roof are spread over it by scroll
// (vh), not evenly: the logo stays near the hero shot through the first sections, the particles and
// the camera do most of their work under the later ones, and the last stretch (the camera settling
// on Blender's "Descent" stop over the skylight) plays while the final edge hands the 3D back.
import { breaksLength, edgeStart, PLAN } from "../../ui/wipe";

/** The intro's dwell in vh: the hero and every break. */
export const INTRO_VH = breaksLength();

/** [scroll vh, story 0–1]: piecewise linear between these, both increasing. */
export const STORY_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [PLAN.hero, 0.06],
  [edgeStart(2), 0.3],
  [edgeStart(PLAN.sections), 0.72],
  [INTRO_VH, 1],
];

/** The story's 0–1 (what the intro's camera and particles follow) at the intro's dwell t. */
export function story(t: number): number {
  const s = Math.min(1, Math.max(0, t)) * INTRO_VH;
  for (let i = 1; i < STORY_KEYS.length; i++) {
    const [s1, v1] = STORY_KEYS[i];
    if (s <= s1 || i === STORY_KEYS.length - 1) {
      const [s0, v0] = STORY_KEYS[i - 1];
      return v0 + ((v1 - v0) * (Math.min(s, s1) - s0)) / (s1 - s0);
    }
  }
  return 1;
}
