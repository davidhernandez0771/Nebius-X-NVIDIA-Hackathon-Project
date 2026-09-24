// A module-level lock ensuring command-listening (useVoiceControl) and
// dictation (useDictation) -- two independent hooks that may be mounted in
// entirely different parts of the app (the /voice page and, per contract,
// Worker 3's assistant composer) -- never hold the microphone at the same
// time. See SANT_VOICE_MODES_PLAN.md §4: "the two must never run
// concurrently". A simple singleton is sufficient because the browser only
// ever runs one page/tab's worth of this module at a time.

export type VoiceSessionOwner = "command" | "dictation";

let current: VoiceSessionOwner | null = null;

/** Returns true if `owner` now holds the session (already held by `owner`, or was free). Returns false if the other mode is active -- the caller must not start listening. */
export function tryAcquireSession(owner: VoiceSessionOwner): boolean {
  if (current !== null && current !== owner) return false;
  current = owner;
  return true;
}

/** No-op if `owner` doesn't currently hold the lock (e.g. double-release). */
export function releaseSession(owner: VoiceSessionOwner): void {
  if (current === owner) current = null;
}

export function currentSessionOwner(): VoiceSessionOwner | null {
  return current;
}

/** Test-only: resets the lock so test files don't leak state into each other. Never call from app code. */
export function __resetSessionLockForTests(): void {
  current = null;
}
