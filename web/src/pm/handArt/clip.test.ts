import { describe, expect, it } from "vitest";
import { initialDirector, stepDirector } from "./artDirector";
import { HAND_ART_STYLES } from "./styleCycle";
import { ClipRecorder, clipDurationMs, parseClip, sampleClip, syntheticClip, type HandClip } from "./clip";

const lm = (x: number) => Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }));

const tiny: HandClip = {
  version: 1,
  source: "test",
  frames: [
    { t: 0, landmarks: lm(0), gripperClosed: false },
    { t: 100, landmarks: lm(1), gripperClosed: true },
    { t: 200, landmarks: null, gripperClosed: false },
  ],
};

describe("sampleClip", () => {
  it("interpolates landmarks between frames", () => {
    const s = sampleClip(tiny, 50);
    expect(s.landmarks![0].x).toBeCloseTo(0.5);
    expect(s.gripperClosed).toBe(false); // the gripper takes the earlier frame's state
    expect(sampleClip(tiny, 100).gripperClosed).toBe(true);
  });

  it("loops past the end", () => {
    expect(clipDurationMs(tiny)).toBe(200);
    expect(sampleClip(tiny, 250).landmarks![0].x).toBeCloseTo(0.5);
  });

  it("does not interpolate into a frame with no hand", () => {
    expect(sampleClip(tiny, 150).landmarks![0].x).toBeCloseTo(1);
  });
});

describe("parseClip", () => {
  it("accepts a valid clip", () => {
    expect(parseClip(JSON.parse(JSON.stringify(tiny)))).toEqual(tiny);
  });

  it("keeps the optional Record signals", () => {
    const withSignals = {
      ...tiny,
      frames: tiny.frames.map((f, i) => ({ ...f, frozen: i === 1, recording: true, resets: i })),
    };
    const parsed = parseClip(JSON.parse(JSON.stringify(withSignals)));
    expect(parsed.frames[1]).toMatchObject({ frozen: true, recording: true, resets: 1 });
    expect(sampleClip(parsed, 120)).toMatchObject({ frozen: true, recording: true, resets: 1 });
  });

  it("explains what is wrong with an invalid one", () => {
    expect(() => parseClip({})).toThrow(/frames/);
    expect(() => parseClip({ version: 1, frames: [] })).toThrow(/at least 2/);
    expect(() =>
      parseClip({ version: 1, frames: [{ t: 0, landmarks: lm(0).slice(1) }, { t: 1, landmarks: null }] }),
    ).toThrow(/21 landmarks/);
    expect(() =>
      parseClip({ version: 1, frames: [{ t: 5, landmarks: null }, { t: 1, landmarks: null }] }),
    ).toThrow(/increase/);
  });
});

describe("syntheticClip", () => {
  const clip = syntheticClip();

  it("is a valid looping clip of a hand", () => {
    expect(parseClip(JSON.parse(JSON.stringify(clip)))).toBeTruthy();
    expect(clipDurationMs(clip)).toBeGreaterThan(5000);
    const tracked = clip.frames.filter((f) => f.landmarks);
    expect(tracked.length).toBeGreaterThan(clip.frames.length * 0.8);
    for (const f of tracked) {
      expect(f.landmarks).toHaveLength(21);
      for (const p of f.landmarks!) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1);
      }
    }
    const first = clip.frames[0].landmarks!;
    const last = clip.frames[clip.frames.length - 1].landmarks!;
    expect(Math.abs(first[8].x - last[8].x)).toBeLessThan(0.01); // seamless loop
  });

  it("opens and closes the gripper at least twice, with the thumb on the index when pinched", () => {
    let changes = 0;
    for (let i = 1; i < clip.frames.length; i++)
      if (clip.frames[i].gripperClosed !== clip.frames[i - 1].gripperClosed) changes++;
    expect(changes).toBeGreaterThanOrEqual(4);
    const pinched = clip.frames.find((f) => f.gripperClosed && f.landmarks)!;
    const [thumb, index, wrist, mid] = [4, 8, 0, 9].map((i) => pinched.landmarks![i]);
    const span = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
    expect(Math.hypot(thumb.x - index.x, thumb.y - index.y)).toBeLessThan(span * 0.6);
  });

  it("plays every Record event, so the director shows all six styles", () => {
    let d = initialDirector();
    const seen = new Set<string>();
    for (let t = 0; t <= clipDurationMs(clip); t += 16) {
      const s = sampleClip(clip, t);
      const r = stepDirector(d, 16, {
        hand: !!s.landmarks,
        gripperClosed: s.gripperClosed,
        recording: !!s.recording,
        resets: s.resets ?? 0,
      });
      d = r.state;
      seen.add(r.style);
    }
    expect([...seen].sort()).toEqual([...HAND_ART_STYLES].sort());
  });

  it("is deterministic", () => {
    expect(syntheticClip()).toEqual(clip);
  });
});

describe("ClipRecorder", () => {
  it("records frames relative to the first one and exports a parseable clip", () => {
    const r = new ClipRecorder("webcam");
    r.add(1000, lm(0), false);
    r.add(1033, null, false);
    r.add(1066, lm(1), true, { frozen: false, recording: true, resets: 2 });
    const clip = r.toClip();
    expect(clip.frames.map((f) => f.t)).toEqual([0, 33, 66]);
    expect(clip.source).toBe("webcam");
    expect(clip.frames[2]).toMatchObject({ recording: true, resets: 2 });
    expect(parseClip(JSON.parse(JSON.stringify(clip)))).toEqual(clip);
  });

  it("stops at its frame limit", () => {
    const r = new ClipRecorder("webcam", 2);
    r.add(0, lm(0), false);
    r.add(1, lm(0), false);
    r.add(2, lm(0), false);
    expect(r.size).toBe(2);
  });
});
