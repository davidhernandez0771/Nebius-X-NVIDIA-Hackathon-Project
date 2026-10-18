import { describe, expect, it } from "vitest";
import { LOST_MS, RELEASE_MS, RESET_MS, initialDirector, stepDirector, type ArtSignals, type DirectorState } from "./artDirector";

const base: ArtSignals = { hand: true, gripperClosed: false, recording: false, resets: 0 };

const run = (s: DirectorState, ms: number, x: ArtSignals, step = 16) => {
  let style = stepDirector(s, 0, x).style;
  for (let t = 0; t < ms; t += step) ({ state: s, style } = stepDirector(s, step, x));
  return { state: s, style };
};

describe("stepDirector: which style each thing that happens shows", () => {
  it("idles in ink, and the first frame is not an event", () => {
    const { style } = stepDirector(initialDirector(), 16, { ...base, gripperClosed: true, resets: 3 });
    expect(style).toBe("bloom"); // a closed gripper is a state, not an event
    expect(run(initialDirector(), 500, base).style).toBe("ink");
  });

  it("blooms while the gripper is closed", () => {
    let s = run(initialDirector(), 100, base).state;
    const r = stepDirector(s, 16, { ...base, gripperClosed: true });
    expect(r.style).toBe("bloom");
    s = run(r.state, 2000, { ...base, gripperClosed: true }).state;
    expect(stepDirector(s, 16, { ...base, gripperClosed: true }).style).toBe("bloom");
  });

  it("bursts on release, for RELEASE_MS, then returns to ink", () => {
    let s = run(initialDirector(), 100, { ...base, gripperClosed: true }).state;
    let r = stepDirector(s, 16, base);
    expect(r.style).toBe("burst");
    r = run(r.state, RELEASE_MS - 100, base);
    expect(r.style).toBe("burst");
    r = run(r.state, 200, base);
    expect(r.style).toBe("ink");
    s = r.state;
    expect(s.releaseLeftMs).toBe(0);
  });

  it("shows the particle trail while recording", () => {
    const s = run(initialDirector(), 100, base).state;
    expect(run(s, 500, { ...base, recording: true }).style).toBe("trail");
  });

  it("ripples once no hand has been tracked for LOST_MS, so a dropped frame doesn't count", () => {
    let r = run(initialDirector(), 100, base);
    r = run(r.state, 60, { ...base, hand: false });
    expect(r.style).toBe("ink");
    r = run(r.state, LOST_MS, { ...base, hand: false });
    expect(r.style).toBe("ripple");
    r = run(r.state, 16, base);
    expect(r.style).toBe("ink");
  });

  it("also ripples while a page reports its arm frozen (optional signal)", () => {
    let r = run(initialDirector(), 100, base);
    r = run(r.state, 100, { ...base, frozen: true });
    expect(r.style).toBe("ripple");
    r = run(r.state, 100, { ...base, frozen: null }); // unknown keeps the last value
    expect(r.style).toBe("ripple");
    r = run(r.state, 100, { ...base, frozen: false });
    expect(r.style).toBe("ink");
  });

  it("glitches for RESET_MS when a reset is sent, then snaps back", () => {
    let r = run(initialDirector(), 100, { ...base, recording: true });
    r = run(r.state, 16, { ...base, recording: true, resets: 1 });
    expect(r.style).toBe("glitch");
    r = run(r.state, RESET_MS + 50, { ...base, recording: true, resets: 1 });
    expect(r.style).toBe("trail");
  });

  it("does not treat a falling reset count (a looping clip) as a reset", () => {
    let r = run(initialDirector(), 100, { ...base, resets: 2 });
    r = run(r.state, 16, { ...base, resets: 0 });
    expect(r.style).toBe("ink");
  });

  it("ranks reset over no-hand over grab over release over recording", () => {
    let r = run(initialDirector(), 100, { ...base, gripperClosed: true, recording: true });
    expect(r.style).toBe("bloom");
    r = run(r.state, 16, { ...base, recording: true }); // release while recording
    expect(r.style).toBe("burst");
    r = run(r.state, LOST_MS + 16, { ...base, recording: true, hand: false });
    expect(r.style).toBe("ripple");
    r = run(r.state, 16, { ...base, recording: true, hand: false, resets: 1 });
    expect(r.style).toBe("glitch");
  });
});

describe("stepDirector with only T4's event counter (pm/hand-v3's Record: landmarks, gripper, cue)", () => {
  const v3 = (cue: number, gripperClosed = false): ArtSignals => ({ hand: true, gripperClosed, cue });

  it("plays the reset glitch for a cue bump the gripper doesn't explain (Reset scene, record start/stop)", () => {
    let r = run(initialDirector(), 100, v3(0));
    r = run(r.state, 16, v3(1));
    expect(r.style).toBe("glitch");
    r = run(r.state, RESET_MS + 50, v3(1));
    expect(r.style).toBe("ink");
  });

  it("reads a cue bump with a gripper change as grab or release, not a reset", () => {
    let r = run(initialDirector(), 100, v3(0));
    r = run(r.state, 16, v3(1, true));
    expect(r.style).toBe("bloom");
    r = run(r.state, 16, v3(2, false));
    expect(r.style).toBe("burst");
  });

  it("ignores the cue when the page sends recording and resets itself", () => {
    let r = run(initialDirector(), 100, { ...base, cue: 0 });
    r = run(r.state, 16, { ...base, cue: 1, recording: true });
    expect(r.style).toBe("trail");
  });
});
