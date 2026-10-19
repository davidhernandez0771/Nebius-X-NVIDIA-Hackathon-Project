import { describe, expect, it } from "vitest";
import { breaksLength } from "../../ui/wipe";
import { INTRO_VH, story, STORY_KEYS } from "./storyline";

describe("the intro's storyline", () => {
  it("spans the breaks, from the hero to the descent", () => {
    expect(INTRO_VH).toBe(breaksLength());
    expect(story(0)).toBe(0);
    expect(story(1)).toBe(1);
    expect(story(-1)).toBe(0);
    expect(story(2)).toBe(1);
  });

  it("has keys that rise in both scroll and story", () => {
    for (let i = 1; i < STORY_KEYS.length; i++) {
      expect(STORY_KEYS[i][0]).toBeGreaterThan(STORY_KEYS[i - 1][0]);
      expect(STORY_KEYS[i][1]).toBeGreaterThan(STORY_KEYS[i - 1][1]);
    }
    expect(STORY_KEYS[STORY_KEYS.length - 1][0]).toBe(INTRO_VH);
  });

  it("passes through every key and rises with no jump in between", () => {
    for (const [s, v] of STORY_KEYS) expect(story(s / INTRO_VH)).toBeCloseTo(v, 10);
    let prev = story(0);
    for (let i = 1; i <= 2000; i++) {
      const v = story(i / 2000);
      expect(v).toBeGreaterThan(prev);
      expect(v - prev).toBeLessThan(0.002);
      prev = v;
    }
  });
});
