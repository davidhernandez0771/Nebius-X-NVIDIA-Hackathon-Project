import { describe, expect, it } from "vitest";
import type { HandFrame, TrackedHand } from "../../hand/contracts";
import { palmCenter } from "./controlRegion";
import { HAND_LOCK_DEFAULTS, HandLock, lockChipText, userHand, type HandLockResult } from "./handLock";
import {
  FRAME_MS,
  MAIN,
  OTHER,
  briefLoss,
  glitchFrame,
  handSwap,
  longLoss,
  recordFrames,
  trackedHand,
  twoHands,
} from "./__fixtures__/handLockFrames";

function run(frames: HandFrame[], lock = new HandLock()): HandLockResult[] {
  return frames.map((f) => lock.update(f));
}

/** Which fixture hand a result is: by where its palm is (MAIN starts left of 0.5, OTHER right). */
function who(h: TrackedHand | null): "main" | "other" | null {
  if (!h) return null;
  return palmCenter(h.landmarks).x < 0.55 ? "main" : "other";
}

describe("HandLock: picking a hand", () => {
  it("locks only after a hand has been held still for ~0.3 s", () => {
    const out = run(twoHands);
    const first = out.findIndex((r) => r.status.phase === "locked");
    const lockedAt = twoHands[first].timestamp - twoHands[0].timestamp;
    expect(lockedAt).toBeGreaterThanOrEqual(HAND_LOCK_DEFAULTS.steadyMs);
    expect(lockedAt).toBeLessThan(HAND_LOCK_DEFAULTS.steadyMs + 2 * FRAME_MS);
    for (const r of out.slice(0, first)) {
      expect(r.hand).toBeNull();
      expect(r.status.phase).toBe("searching");
    }
    expect(out[first].status.handedness).toBe("Left");
  });

  it("reports the steady progress while searching", () => {
    const out = run(twoHands.slice(0, 12));
    const p = out.map((r) => r.status.progress);
    expect(p[0]).toBe(0);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1]);
    expect(p[p.length - 1]).toBeGreaterThan(0.5);
  });

  it("never locks a moving hand", () => {
    const sweep = recordFrames(40, (i) => [{ ...MAIN, center: { x: 0.2 + i * 0.015, y: 0.5 } }]);
    expect(run(sweep).every((r) => r.hand === null)).toBe(true);
  });

  it("a second hand with the same label moving nearby doesn't delay or steal the lock", () => {
    // MAIN still; a second "Left" hand sweeping right from next to it. MAIN locks on time.
    const twins = recordFrames(20, (i) => [MAIN, { ...MAIN, center: { x: 0.4 + i * 0.02, y: 0.55 } }]);
    const out = run(twins);
    const first = out.findIndex((r) => r.hand);
    expect(twins[first].timestamp - twins[0].timestamp).toBeLessThan(HAND_LOCK_DEFAULTS.steadyMs + 2 * FRAME_MS);
    expect(Math.abs(palmCenter(out[first].hand!.landmarks).x - palmCenter(trackedHand(MAIN).landmarks).x)).toBeLessThan(0.01);
  });

  it("never locks a hand without a handedness label", () => {
    const unlabeled = recordFrames(30, () => [{ ...MAIN, label: null }]);
    expect(run(unlabeled).every((r) => r.hand === null)).toBe(true);
  });
});

describe("HandLock: the other hand is ignored", () => {
  it("two hands: follows the locked hand only, even when the other is closer to the camera", () => {
    const out = run(twoHands);
    const first = out.findIndex((r) => r.status.phase === "locked");
    for (const r of out.slice(first)) {
      expect(r.status.phase).toBe("locked");
      expect(who(r.hand)).toBe("main");
      expect(r.hand?.handedness).toBe("Left");
    }
    // It follows MAIN's slow drift instead of freezing.
    expect(palmCenter(out[out.length - 1].hand!.landmarks).x).toBeGreaterThan(palmCenter(out[first].hand!.landmarks).x + 0.1);
  });

  it("hand swap: both hands in view from the start, the array order shuffling every frame", () => {
    const out = run(handSwap);
    const first = out.findIndex((r) => r.status.phase === "locked");
    expect(first).toBeGreaterThan(0);
    for (const r of out.slice(first)) expect(who(r.hand)).toBe("main");
  });

  it("hand swap: frames whose labels swap are held, never the other hand", () => {
    const out = run(handSwap);
    for (let i = 30; i < 34; i++) {
      expect(out[i].status.phase).toBe("holding");
      expect(out[i].status.held).toBe("glitch"); // a "Left" hand exists, but far from MAIN's palm
      expect(out[i].hand).toBe(out[29].hand); // the last good pose, unchanged
    }
    expect(out[34].status.phase).toBe("locked");
    expect(who(out[34].hand)).toBe("main");
  });

  it("a hand already locked keeps the lock when both start steady at the same time", () => {
    const both = recordFrames(30, () => [MAIN, OTHER]);
    const out = run(both);
    const locked = out.filter((r) => r.hand);
    expect(locked.length).toBeGreaterThan(10);
    const label = locked[0].hand!.handedness;
    expect(locked.every((r) => r.hand!.handedness === label)).toBe(true);
  });
});

describe("HandLock: losing the hand", () => {
  it("brief loss: holds the last pose, ignores the other hand, re-locks near the last position", () => {
    const out = run(briefLoss);
    for (let i = 20; i < 32; i++) {
      expect(out[i].status.phase).toBe("holding");
      expect(out[i].status.held).toBe("missing");
      expect(out[i].hand).toBe(out[19].hand);
    }
    expect(out[32].status.phase).toBe("locked");
    expect(who(out[32].hand)).toBe("main");
    expect(palmCenter(out[32].hand!.landmarks).x).toBeGreaterThan(palmCenter(out[19].hand!.landmarks).x + 0.02);
  });

  it("long loss: stops holding after ~0.7 s, never takes the other hand, re-locks only after 0.3 s steady", () => {
    const out = run(longLoss);
    const lostAt = longLoss[20].timestamp;
    for (let i = 20; i < 60; i++) {
      const since = longLoss[i].timestamp - longLoss[19].timestamp;
      if (since <= HAND_LOCK_DEFAULTS.holdMs) {
        expect(out[i].status.phase).toBe("holding");
        expect(out[i].hand).toBe(out[19].hand);
      } else {
        expect(out[i].status.phase).toBe("lost");
        expect(out[i].hand).toBeNull();
      }
    }
    expect(longLoss[59].timestamp - lostAt).toBeGreaterThan(HAND_LOCK_DEFAULTS.holdMs);
    // Back far away: not near the last position, so the steady 0.3 s again.
    const back = out.findIndex((r, i) => i >= 60 && r.status.phase === "locked");
    expect(longLoss[back].timestamp - longLoss[60].timestamp).toBeGreaterThanOrEqual(HAND_LOCK_DEFAULTS.steadyMs);
    for (let i = 60; i < back; i++) expect(out[i].hand).toBeNull();
    expect(who(out[back].hand)).toBe("main");
    expect(out[back].hand?.handedness).toBe("Left");
  });

  it("the lock's handedness is kept through a long loss", () => {
    const out = run(longLoss);
    for (let i = 20; i < 90; i++) expect(out[i].status.handedness).toBe("Left");
  });
});

describe("HandLock: one-frame glitch", () => {
  it("a single frame jumping more than the threshold is held; the next frame continues", () => {
    const out = run(glitchFrame);
    expect(out[24].status.phase).toBe("locked");
    expect(out[25].status.phase).toBe("holding");
    expect(out[25].status.held).toBe("glitch");
    expect(out[25].hand).toBe(out[24].hand);
    expect(out[26].status.phase).toBe("locked");
    expect(out[26].hand).toBe(glitchFrame[26].hands[0]);
  });

  it("a jump under the threshold is followed", () => {
    const step = recordFrames(30, (i) => [{ ...MAIN, center: { x: 0.35, y: i === 20 ? 0.6 : 0.55 } }]);
    const out = run(step);
    expect(out[20].status.phase).toBe("locked");
    expect(out[20].hand).toBe(step[20].hands[0]);
  });
});

describe("HandLock: re-pick", () => {
  it("reset() drops the lock; the next hand held still 0.3 s locks, whichever it is", () => {
    const lock = new HandLock();
    run(twoHands, lock);
    lock.reset();
    expect(lock.status.phase).toBe("searching");
    expect(lock.status.handedness).toBeNull();
    const onlyOther = recordFrames(20, () => [OTHER], { t0: 10_000 });
    const out = run(onlyOther, lock);
    expect(out[out.length - 1].status.phase).toBe("locked");
    expect(who(out[out.length - 1].hand)).toBe("other");
  });
});

describe("chip text", () => {
  it("names the user's hand: MediaPipe's label is mirrored on the raw camera frame", () => {
    expect(userHand("Left")).toBe("right");
    expect(userHand("Right")).toBe("left");
  });

  it("one short line per state", () => {
    expect(lockChipText({ phase: "locked", handedness: "Left", progress: 1, held: null })).toBe("locked: right hand");
    expect(lockChipText({ phase: "holding", handedness: "Right", progress: 1, held: "missing" })).toBe("holding: left hand");
    expect(lockChipText({ phase: "lost", handedness: "Left", progress: 0, held: null })).toBe("lost: show your right hand");
    expect(lockChipText({ phase: "searching", handedness: null, progress: 0.4, held: null })).toBe("hold one hand still");
  });
});
