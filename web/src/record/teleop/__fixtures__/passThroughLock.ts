// Test-only stand-in for HandLock: every frame's hand is used at once, picked the way the page did
// before the lock (MediaPipe's "Right" label, else the first hand). For the page tests, which move
// one hand between test poses in single jumps that the real lock would hold as glitches; the lock
// itself is tested in handLock.test.ts and, wired into the session, useRecordSession.handLock.test.ts.
//
//   vi.mock(".../record/teleop/handLock", async (importOriginal) => ({
//     ...(await importOriginal<typeof import(".../record/teleop/handLock")>()),
//     HandLock: (await import(".../record/teleop/__fixtures__/passThroughLock")).PassThroughHandLock,
//   }));

import type { HandFrame } from "../../../hand/contracts";
import type { HandLockResult, HandLockStatus } from "../handLock";

export class PassThroughHandLock {
  status: HandLockStatus = { phase: "searching", handedness: null, progress: 0, held: null };

  reset(): void {
    this.status = { phase: "searching", handedness: null, progress: 0, held: null };
  }

  update(frame: HandFrame): HandLockResult {
    const hand = frame.hands.find((h) => h.handedness === "Right") ?? frame.hands[0] ?? null;
    this.status = hand
      ? { phase: "locked", handedness: hand.handedness, progress: 1, held: null }
      : { phase: "searching", handedness: null, progress: 0, held: null };
    return { hand, status: this.status };
  }
}
