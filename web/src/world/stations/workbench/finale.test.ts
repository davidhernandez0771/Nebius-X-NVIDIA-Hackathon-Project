import { describe, expect, it } from "vitest";
import { FINALE, finaleAt, popParticle, printWipe } from "./finale";
import { FLIGHT_S } from "./layout";

describe("the finish (\"pum\")", () => {
  it("clicks the cartridge into the turntable, then lets go with a small overshoot", () => {
    expect(finaleAt(0).press).toBe(0);
    let low = 0;
    let lowAt = 0;
    let high = 0;
    for (let t = 0; t <= FINALE.flyAt; t += 0.005) {
      const p = finaleAt(t).press;
      if (p < low) [low, lowAt] = [p, t];
      high = Math.max(high, p);
    }
    // Down a few centimetres, quickly, and back up past rest by a hair.
    expect(low).toBeCloseTo(-FINALE.pressDepth, 3);
    expect(lowAt).toBeGreaterThan(0.08);
    expect(lowAt).toBeLessThan(0.25);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(FINALE.pressDepth * 0.3);
    expect(Math.abs(finaleAt(FINALE.flyAt).press)).toBeLessThan(1e-3);
  });

  it("sweeps a light across the shell and pops its sparks at the click", () => {
    expect(finaleAt(0).sweep).toBe(0);
    expect(finaleAt(FINALE.sweepAt - 0.01).sweep).toBe(0);
    const mid = finaleAt(FINALE.sweepAt + FINALE.sweepS / 2).sweep;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(finaleAt(FINALE.sweepAt + FINALE.sweepS + 0.01).sweep).toBe(1);
    expect(finaleAt(FINALE.popAt - 0.01).pop).toBe(0);
    expect(finaleAt(FINALE.popAt + FINALE.popS / 2).pop).toBeGreaterThan(0);
    expect(finaleAt(FINALE.popAt + FINALE.popS + 0.01).pop).toBe(1);
    // The sparks go at the bottom of the click.
    const bottom = [0, 0.05, 0.1, 0.15, 0.2, 0.25].reduce((a, t) => (finaleAt(t).press < finaleAt(a).press ? t : a), 0);
    expect(Math.abs(FINALE.popAt - bottom)).toBeLessThan(0.06);
  });

  it("flies to the spiral after it, and is over when it lands", () => {
    expect(finaleAt(FINALE.flyAt - 0.01).fly).toBe(0);
    expect(finaleAt(FINALE.flyAt + FLIGHT_S / 2).fly).toBeCloseTo(0.5, 6);
    expect(finaleAt(FINALE.end).fly).toBe(1);
    expect(finaleAt(FINALE.end).done).toBe(true);
    expect(finaleAt(FINALE.end - 0.01).done).toBe(false);
    expect(FINALE.end).toBeCloseTo(FINALE.flyAt + FLIGHT_S, 9);
    // The whole moment stays short: under two and a half seconds.
    expect(FINALE.end).toBeLessThan(2.5);
  });

  it("with reduced motion is over at once: no click, no sweep, no sparks", () => {
    const r = finaleAt(0, true);
    expect(r).toEqual({ press: 0, squash: 1, sweep: 1, pop: 1, fly: 1, done: true });
  });

  it("squashes a touch at the click and is back to its size by the flight", () => {
    let least = 1;
    for (let t = 0; t <= FINALE.flyAt; t += 0.01) least = Math.min(least, finaleAt(t).squash);
    expect(least).toBeLessThan(1);
    expect(least).toBeGreaterThan(0.95);
    expect(finaleAt(FINALE.flyAt).squash).toBeCloseTo(1, 3);
  });
});

describe("the sparks", () => {
  it("burst out and upward from the cartridge, slow down, and fall a little", () => {
    const a = popParticle(7, 0.1);
    const b = popParticle(7, 0.6);
    const c = popParticle(7, 1);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(Math.hypot(b.x, b.z));
    // Fast first, then slower (eased out).
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(Math.hypot(c.x - b.x, c.z - b.z));
    expect(c.alpha).toBe(0);
    expect(a.alpha).toBeGreaterThan(b.alpha);
    // The same seed, the same spark.
    expect(popParticle(7, 0.4)).toEqual(popParticle(7, 0.4));
  });
});

describe("the label printing onto the cartridge", () => {
  it("runs the print head down the label once, then leaves it printed", () => {
    expect(printWipe(-1)).toBe(1);
    expect(printWipe(0)).toBe(0);
    expect(printWipe(0.5 * FINALE.printS)).toBeGreaterThan(0.3);
    expect(printWipe(FINALE.printS)).toBe(1);
    expect(printWipe(FINALE.printS * 3)).toBe(1);
    for (let t = 0; t < FINALE.printS; t += 0.02) expect(printWipe(t + 0.02)).toBeGreaterThanOrEqual(printWipe(t));
  });
});
