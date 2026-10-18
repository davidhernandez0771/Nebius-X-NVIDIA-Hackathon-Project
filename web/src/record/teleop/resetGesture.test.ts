import { describe, expect, it } from "vitest";
import type { TrackedHand } from "../../hand/contracts";
import { palmCenter } from "./controlRegion";
import {
  DEFAULT_RESET_GESTURE_OPTIONS as D,
  createResetGesture,
  type ResetGestureSample,
  type ResetGestureStatus,
} from "./resetGesture";
import { victoryScore } from "./victoryPose";
import { FRAME, VICTORY_FLEX, VICTORY_THUMB, makeHandPose, type HandPoseOptions } from "./__fixtures__/handPoses";

const FRAME_MS = 1000 / 30;

function sample(t: number, over: Partial<ResetGestureSample> = {}): ResetGestureSample {
  return {
    timestamp: t,
    victory: 0.9,
    gripperOpen: true,
    position: { x: 0.5, y: 0.5 },
    ...over,
  };
}

/** Feeds frames at 30 fps from t0 for `ms`, with `over(t, i)` overriding fields. Returns every status. */
function feed(
  rg: ReturnType<typeof createResetGesture>,
  t0: number,
  ms: number,
  over: (t: number, i: number) => Partial<ResetGestureSample> = () => ({}),
): ResetGestureStatus[] {
  const out: ResetGestureStatus[] = [];
  for (let i = 0; t0 + i * FRAME_MS <= t0 + ms + 1e-9; i++) {
    const t = t0 + i * FRAME_MS;
    out.push(rg.update(sample(t, over(t, i))));
  }
  return out;
}

const events = (s: ResetGestureStatus[]) => s.filter((x) => x.event).map((x) => x.event);

describe("resetGesture: Victory held 1.5 s", () => {
  it("has live test #8's stricter defaults: score >= 0.85 held 1.5 s", () => {
    expect(D.holdMs).toBe(1500);
    expect(D.minScore).toBe(0.85);
    expect(D.minHitFraction).toBe(0.8);
  });

  it("starts on a qualifying frame, fills progress 0..1 with time, and fires once at 1.5 s", () => {
    const rg = createResetGesture();
    const first = rg.update(sample(1000));
    expect(first).toMatchObject({ phase: "holding", event: "start", progress: 0 });

    const mid = rg.update(sample(1750));
    expect(mid.phase).toBe("holding");
    expect(mid.progress).toBeCloseTo(0.5);
    expect(mid.event).toBeNull();

    const s = feed(rg, 1750 + FRAME_MS, 2600 - 1750 - FRAME_MS);
    const fired = s.filter((x) => x.event === "fire");
    expect(fired).toHaveLength(1);
    expect(fired[0].progress).toBe(1);
    expect(fired[0].timestamp).toBeGreaterThanOrEqual(2500);
    expect(fired[0].timestamp).toBeLessThan(2500 + FRAME_MS + 1e-9);
  });

  it("progress never goes backwards or above 1 during a clean hold", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 1500);
    const holding = s.filter((x) => x.phase === "holding" || x.event === "fire").map((x) => x.progress);
    for (let i = 1; i < holding.length; i++) expect(holding[i]).toBeGreaterThanOrEqual(holding[i - 1]);
    expect(Math.max(...holding)).toBe(1);
  });

  it("does not fire with too few qualifying frames: the score must reach 0.85", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 3000, () => ({ victory: 0.84 }));
    expect(events(s)).toEqual([]);
    expect(s.every((x) => x.phase === "idle" && x.progress === 0)).toBe(true);
  });

  it("other hand shapes (a low Victory score) never start it", () => {
    const rg = createResetGesture();
    for (const victory of [0, 0.2, 0.5, 0.7, 0.84]) {
      const s = feed(rg, 0, 2000, () => ({ victory }));
      expect(events(s)).toEqual([]);
    }
  });

  it("tolerates a few missed frames (>= 80% of the window's frames still qualify)", () => {
    const rg = createResetGesture();
    // every 8th frame misses: 87.5% hits, and no gap is longer than one frame
    const s = feed(rg, 0, 1600, (_t, i) => (i % 8 === 7 ? { victory: 0.1 } : {}));
    expect(events(s)).toEqual(["start", "fire"]);
  });

  it("cancels when fewer than 80% of the window's frames qualify", () => {
    const rg = createResetGesture();
    // every 3rd frame misses: 67% hits, each gap one frame (shorter than the drop grace)
    const s = feed(rg, 0, 1600, (_t, i) => (i % 3 === 2 ? { victory: 0.1 } : {}));
    expect(events(s)).not.toContain("fire");
    const cancel = s.find((x) => x.event === "cancel");
    expect(cancel?.cancelReason).toBe("low-score");
  });

  it("cancels when the gesture drops for longer than the grace, and resets progress", () => {
    const rg = createResetGesture();
    feed(rg, 0, 900);
    const s = feed(rg, 900 + FRAME_MS, D.dropGraceMs + 3 * FRAME_MS, () => ({ victory: null }));
    const cancel = s.find((x) => x.event === "cancel");
    expect(cancel?.cancelReason).toBe("dropped");
    expect(cancel?.progress).toBe(0);
    expect(cancel?.phase).toBe("idle");
  });

  it("cancels on a missing hand for longer than the grace (no sample position, no gesture)", () => {
    const rg = createResetGesture();
    feed(rg, 0, 600);
    const s = feed(rg, 600 + FRAME_MS, D.dropGraceMs + 3 * FRAME_MS, () => ({ victory: null, position: null }));
    expect(s.find((x) => x.event === "cancel")?.cancelReason).toBe("dropped");
  });

  it("needs the gripper open: a closed gripper never starts it and cancels a hold", () => {
    const rg = createResetGesture();
    expect(events(feed(rg, 0, 2000, () => ({ gripperOpen: false })))).toEqual([]);

    const rg2 = createResetGesture();
    feed(rg2, 0, 800);
    const s = rg2.update(sample(800 + FRAME_MS, { gripperOpen: false }));
    expect(s).toMatchObject({ event: "cancel", cancelReason: "gripper", phase: "idle", progress: 0 });
  });

  it("needs the hand roughly still: drifting past the limit cancels", () => {
    const rg = createResetGesture();
    // moves 0.004 per frame: past maxDrift (0.06) after ~15 frames (0.5 s)
    const s = feed(rg, 0, 1600, (_t, i) => ({ position: { x: 0.5 + 0.004 * i, y: 0.5 } }));
    expect(events(s)).not.toContain("fire");
    expect(s.find((x) => x.event === "cancel")?.cancelReason).toBe("moved");
  });

  it("small jitter inside the limit is fine", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 1600, (_t, i) => ({ position: { x: 0.5 + (i % 2 ? 0.01 : -0.01), y: 0.5 + (i % 3 ? 0.01 : 0) } }));
    expect(events(s)).toEqual(["start", "fire"]);
  });

  it("measures drift in aspect-correct units when frame size is given", () => {
    // 0.05 in x on a 16:9 frame is 0.089 in height units: past maxDrift 0.06
    const rg = createResetGesture({ aspect: 16 / 9 });
    rg.update(sample(0));
    const s = rg.update(sample(FRAME_MS, { position: { x: 0.55, y: 0.5 } }));
    expect(s).toMatchObject({ event: "cancel", cancelReason: "moved" });
  });

  it("applies a cooldown after firing, then needs the gesture released before re-arming", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 1500 + D.cooldownMs + 2000); // Victory held through it all
    expect(events(s)).toEqual(["start", "fire"]);
    const after = s.filter((x) => x.timestamp > 1500 + FRAME_MS && x.timestamp < 1500 + D.cooldownMs);
    expect(after.every((x) => x.phase === "cooldown" && x.progress === 0)).toBe(true);
    // still holding after the cooldown: no new start until a release
    expect(s[s.length - 1].phase).toBe("idle");

    const released = feed(rg, s[s.length - 1].timestamp + FRAME_MS, D.releaseMs + FRAME_MS, () => ({ victory: 0 }));
    expect(events(released)).toEqual([]);
    const again = feed(rg, released[released.length - 1].timestamp + FRAME_MS, 1600);
    expect(events(again)).toEqual(["start", "fire"]);
  });

  // Live test #7: the arm flickered at rest. A V held still (or a resting hand that scores near the
  // threshold) has single noisy frames below it; one such frame re-armed the gesture, so it fired
  // again every cooldown + hold (~3.5 s), and each fire snaps the arm home.
  it("one noisy frame is not a release: a V kept up fires once, not every few seconds", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 10_000, (_t, i) => (i % 10 === 9 ? { victory: 0.5 } : {}));
    expect(events(s).filter((e) => e === "fire")).toHaveLength(1);
  });

  it("a release needs releaseMs without the sign", () => {
    const rg = createResetGesture();
    feed(rg, 0, 1600);
    const gap = feed(rg, 1600 + FRAME_MS, D.releaseMs - 3 * FRAME_MS, () => ({ victory: 0 }));
    const t = gap[gap.length - 1].timestamp + FRAME_MS;
    expect(events(feed(rg, Math.max(t, 1500 + D.cooldownMs), 1600))).toEqual([]); // released too briefly
  });

  it("a release during the cooldown counts, so it re-arms right after the cooldown", () => {
    const rg = createResetGesture();
    expect(events(feed(rg, 0, 1600))).toEqual(["start", "fire"]);
    feed(rg, 1700, D.releaseMs + FRAME_MS, () => ({ victory: null }));
    const s = feed(rg, 1500 + D.cooldownMs + 10, 1600);
    expect(events(s)).toEqual(["start", "fire"]);
  });

  it("fires only on a hit frame: reaching 1.5 s on a missed frame waits for the next hit", () => {
    const rg = createResetGesture();
    rg.update(sample(0));
    for (let t = 100; t <= 1400; t += 100) rg.update(sample(t));
    const miss = rg.update(sample(1510, { victory: null }));
    expect(miss).toMatchObject({ phase: "holding", progress: 1, event: null });
    expect(rg.update(sample(1540))).toMatchObject({ event: "fire", phase: "cooldown" });
  });

  it("a score of exactly 0.85 counts as a hit", () => {
    const rg = createResetGesture();
    const s = feed(rg, 0, 1600, () => ({ victory: 0.85 }));
    expect(events(s)).toEqual(["start", "fire"]);
  });

  it("ignores a sample whose timestamp does not increase", () => {
    const rg = createResetGesture();
    rg.update(sample(1000));
    const before = rg.update(sample(1300));
    const stale = rg.update(sample(1200));
    expect(stale.progress).toBeCloseTo(before.progress);
    expect(stale.event).toBeNull();
  });

  it("reset() returns to idle with no cooldown", () => {
    const rg = createResetGesture();
    feed(rg, 0, 1500);
    rg.reset();
    const s = feed(rg, 2000, 1600);
    expect(events(s)).toEqual(["start", "fire"]);
  });

  it("a cancelled hold can start again on the next qualifying frame", () => {
    const rg = createResetGesture();
    feed(rg, 0, 500);
    rg.update(sample(500 + FRAME_MS, { gripperOpen: false }));
    const s = feed(rg, 600, 1600);
    expect(events(s)).toEqual(["start", "fire"]);
  });
});

// --- A still hand with tracking noise, through victoryScore (live test #7's flicker) -------------

/** 10 s of a still hand at 30 fps with ~1 px image and ~1.5 mm world noise; returns the fires. */
function stillHandFires(opts: HandPoseOptions): number {
  let seed = 7;
  const u = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  const base = makeHandPose({ ...opts, center: { x: 0.5, y: 0.55 } });
  const rg = createResetGesture({ aspect: FRAME.w / FRAME.h });
  let fires = 0;
  for (let k = 0; k < 300; k++) {
    const hand: TrackedHand = {
      handedness: "Right",
      landmarks: base.landmarks.map((p) => ({ x: p.x + n() * 0.0015, y: p.y + n() * 0.0015, z: p.z })),
      worldLandmarks: base.world.map((p) => ({ x: p.x + n() * 0.0015, y: p.y + n() * 0.0015, z: p.z + n() * 0.0015 })),
    };
    const victory = victoryScore(hand, FRAME.w, FRAME.h).score;
    const s = rg.update({ timestamp: k * FRAME_MS, victory, gripperOpen: true, position: palmCenter(hand.landmarks) });
    if (s.event === "fire") fires++;
  }
  return fires;
}

describe("resetGesture: a still hand with tracking noise", () => {
  it("a resting hand (index and middle loose, ring and pinky curled) never resets", () => {
    expect(stillHandFires({ fingerFlex: [[0.25, 0.35, 0.2], [0.3, 0.4, 0.2], [0.9, 1.1, 0.6], [1.0, 1.2, 0.7]] })).toBe(0);
    expect(stillHandFires({ fingerFlex: [[0.2, 0.3, 0.2], [0.2, 0.3, 0.2], [1.2, 1.4, 0.8], [1.2, 1.4, 0.8]] })).toBe(0);
  });

  it("a real V sign held still for 10 s resets exactly once", () => {
    expect(stillHandFires({ fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB })).toBe(1);
  });
});
