import { afterEach, describe, expect, it } from "vitest";
import { __resetSessionLockForTests, currentSessionOwner, releaseSession, tryAcquireSession } from "./sessionLock";

describe("sessionLock", () => {
  afterEach(() => {
    __resetSessionLockForTests();
  });

  it("grants the lock to whichever mode asks first", () => {
    expect(tryAcquireSession("command")).toBe(true);
    expect(currentSessionOwner()).toBe("command");
  });

  it("refuses the other mode while one holds the lock", () => {
    expect(tryAcquireSession("command")).toBe(true);
    expect(tryAcquireSession("dictation")).toBe(false);
    expect(currentSessionOwner()).toBe("command");
  });

  it("re-acquiring by the same owner is a no-op success", () => {
    expect(tryAcquireSession("dictation")).toBe(true);
    expect(tryAcquireSession("dictation")).toBe(true);
  });

  it("frees the lock on release, letting the other mode acquire it", () => {
    tryAcquireSession("command");
    releaseSession("command");
    expect(currentSessionOwner()).toBe(null);
    expect(tryAcquireSession("dictation")).toBe(true);
  });

  it("releasing a lock you don't hold is a no-op", () => {
    tryAcquireSession("command");
    releaseSession("dictation");
    expect(currentSessionOwner()).toBe("command");
  });
});
