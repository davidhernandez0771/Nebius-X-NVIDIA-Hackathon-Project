// The canvas pausing while the tab is hidden: no frames then, and the clock resumes where it stopped.
import { Clock } from "three";
import { describe, expect, it, vi } from "vitest";
import { createPause } from "./Perf";

/** r3f 8's setFrameloop, as it is: it stops the clock and starts it again from 0. */
function fakeCanvas(clock: Clock) {
  const state = { frameloop: "demand" as string, clock, invalidate: vi.fn() };
  const setFrameloop = (f: string) => {
    clock.stop();
    clock.elapsedTime = 0;
    if (f !== "never") {
      clock.start();
      clock.elapsedTime = 0;
    }
    state.frameloop = f;
  };
  return { state, setFrameloop };
}

describe("pausing the canvas while the tab is hidden", () => {
  it("stops the frames, and on return the clock carries on from where it stopped (not 0)", () => {
    const clock = new Clock();
    clock.start();
    clock.elapsedTime = 25;
    const { state, setFrameloop } = fakeCanvas(clock);
    const pause = createPause({ setFrameloop, clock, invalidate: state.invalidate });
    pause(true);
    expect(state.frameloop).toBe("never");
    pause(false);
    expect(state.frameloop).toBe("demand");
    // The lamps' power-on started at some earlier time: it must still be in the past, or the room goes dark.
    expect(clock.elapsedTime).toBeGreaterThanOrEqual(25);
    expect(clock.getElapsedTime()).toBeLessThan(26);
    expect(state.invalidate).toHaveBeenCalled();
  });

  it("a second hidden or visible event changes nothing", () => {
    const clock = new Clock();
    clock.start();
    clock.elapsedTime = 12;
    const { state, setFrameloop } = fakeCanvas(clock);
    const pause = createPause({ setFrameloop, clock, invalidate: state.invalidate });
    pause(true);
    pause(true);
    pause(false);
    expect(clock.elapsedTime).toBeGreaterThanOrEqual(12);
    pause(false);
    expect(clock.elapsedTime).toBeGreaterThanOrEqual(12);
    expect(state.frameloop).toBe("demand");
  });
});
