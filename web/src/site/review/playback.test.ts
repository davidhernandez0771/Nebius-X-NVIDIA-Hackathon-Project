import { describe, expect, it } from "vitest";
import { MORPH_SECONDS, SPEED, advance, type PlayState } from "./playback";

const durs = { raw: 13.76, perfected: 9.32 };
const at = (s: Partial<PlayState>): PlayState => ({ mode: "raw", t: 0, morph: 0, playing: true, ...s });

describe("advance", () => {
  it("plays the raw demo at the playback speed", () => {
    expect(advance(at({ t: 1 }), 0.5, durs).t).toBeCloseTo(1 + 0.5 * SPEED);
  });

  it("hands over from the end of the raw demo to the morph, then to the perfected demo from 0", () => {
    const morphing = advance(at({ t: 13.7 }), 0.1, durs);
    expect(morphing).toMatchObject({ mode: "morph", morph: 0, t: 13.76 });
    const done = advance(at({ mode: "morph", morph: 0.99, t: 13.76 }), MORPH_SECONDS * 0.02, durs);
    expect(done).toMatchObject({ mode: "perfected", t: 0, morph: 1 });
  });

  it("stops at the end of the perfected demo", () => {
    expect(advance(at({ mode: "perfected", t: 9.3 }), 1, durs)).toMatchObject({ mode: "perfected", t: 9.32, playing: false });
  });

  it("stops at the end of the raw demo when there is no perfected one", () => {
    expect(advance(at({ t: 13.7 }), 1, { raw: 13.76, perfected: null })).toMatchObject({ mode: "raw", t: 13.76, playing: false });
  });

  it("does nothing while paused", () => {
    const paused = at({ t: 3, playing: false });
    expect(advance(paused, 1, durs)).toBe(paused);
  });
});
