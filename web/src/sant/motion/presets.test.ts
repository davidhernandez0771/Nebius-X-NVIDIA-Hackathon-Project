import { describe, expect, it, vi } from "vitest";
import { countUp } from "./presets";

describe("countUp", () => {
  it("jumps straight to the final value when motion is reduced", () => {
    const onUpdate = vi.fn();
    const stop = countUp({ to: 42.5, reduced: true, onUpdate });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(42.5);
    expect(() => stop()).not.toThrow();
  });

  it("never reports a value past the target (no overshoot on a measured number)", async () => {
    const seen: number[] = [];
    await new Promise<void>((resolve) => {
      countUp({ to: 17, duration: 60, reduced: false, onUpdate: (v) => seen.push(v), onComplete: resolve });
    });
    expect(Math.max(...seen)).toBeLessThanOrEqual(17);
    expect(seen[seen.length - 1]).toBe(17);
  });
});
