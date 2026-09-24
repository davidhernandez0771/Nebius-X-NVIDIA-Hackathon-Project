# Worker 1 handoff — voice input and command recognition

Scope: everything under `web/src/voice/` except `voice/types.ts` (frozen,
coordinator-owned; read-only import). See `SANT_VOICE_MODES_PLAN.md` §4 for
the assignment this implements.

## What was built

- **`microphone.ts`** — mic lifecycle independent of whatever a
  `SpeechProvider` does internally: `requestMicrophone()` acquires its own
  `getUserMedia` stream, classifies failures into a typed `MicError`
  (`unsupported` / `permission-denied` / `device-not-found` / `unknown`)
  instead of leaking browser-specific `DOMException` names, detects
  mid-session interruption (`onInterrupted`), and `release()` stops every
  track and is idempotent. `queryMicPermissionState()` is a best-effort,
  non-throwing read via the Permissions API (falls back to `"unknown"`
  wherever unsupported, e.g. Safari).
- **`providers/`** — the replaceable speech-engine boundary.
  `providers/types.ts` defines `SpeechProvider` (`name`, `privacy`,
  `isSupported()`, `start()`, `stop()`). `providers/webSpeechProvider.ts` is
  the only concrete implementation this round, wrapping the non-standard
  `SpeechRecognition`/`webkitSpeechRecognition` API (declared locally —
  it's not fully in TypeScript's bundled DOM lib, and the constructor only
  exists at runtime, Chromium-prefixed). `providers/index.ts` exposes
  `createDefaultSpeechProvider`, the one line that would change to swap in
  a real local engine later.
- **`wakeWord.ts`** — `containsWakeWord()` / `textAfterWakeWord()`, pure
  string functions using the shared `WAKE_WORD` constant from
  `../commands/types` (never a second hardcoded `"sant"`).
- **`sessionLock.ts`** — a module-level singleton so command-listening and
  dictation (two independent hooks, potentially mounted in different parts
  of the app) can never hold the mic at the same time, per the plan's
  requirement. `tryAcquireSession` / `releaseSession` / `currentSessionOwner`.
- **`commandListening.ts`** — `createCommandListener(deps, events)`: wake →
  arm a command window → accumulate transcript → finalize (on a final
  transcript, a window timeout, or push-to-talk release) → `matchPhrase()`
  → `executeAction()`. Never executes on an interim transcript. Also
  exposes `armManually()`/`finalizeNow()` for push-to-talk.
  **Deliberately takes `matchPhrase` as an injected dependency** rather
  than importing `../commands/matcher` itself — see "Integration notes"
  below.
- **`dictation.ts`** — `useDictation` implementing `UseDictation` from
  `./types.ts` exactly (the function shape is frozen). Internals:
  `createUseDictation(providerFactory)` for testability, with the public
  `useDictation` bound to the real default provider. Guarded by
  `sessionLock` the same way command mode is. `start`/`stop` stay `() =>
  void` per the frozen `DictationController` type — a `startTokenRef`
  counter invalidates a stale in-flight `requestMicrophone()`/`start()`
  call if `stop()` (or unmount) runs first, since neither can return a
  cleanup closure.
- **`useVoiceControl.ts`** — top-level command-mode hook wiring
  microphone + provider + wake word + command listener into
  `VoiceListeningState`. Auto-restarts the provider session if the engine
  ends itself (e.g. a silence timeout) while voice is still meant to be on.
  Auto-reverts `success`/`error` back to `listening` after 3s (display
  nicety only — voice stays enabled the whole time). Exposes
  `enable`/`disable`/`startPushToTalk`/`endPushToTalk` plus `provider` (the
  active engine's name + privacy, for the UI's honesty disclosure).
- **`VoicePage.tsx`** (`/voice` route content — route itself added by the
  coordinator per §8) — mode switch (off / command / dictation), state
  pill, push-to-talk button, recognized-phrase + matched-action + result
  display, dictated-text panel, an always-visible "how this actually
  works" disclosure (see honesty section below), and a physical-mic manual
  checklist. Wires the real `getCommandsRepository()` from Worker 2's
  `../commands/store.ts` (see "Integration notes").
- **`voicePage.css`** — small colocated stylesheet, reusing the app's
  existing `glass-card`/`status-pill`/`muted` tokens rather than a new
  visual system.

## Wake-word honesty (plan §6) — this is Prototype B, not A

This implementation is **Prototype B**: it recognizes "Sant" inside text
that the browser's Web Speech API has already sent to a remote server
(Google's, in Chrome) for transcription. It is **not** a local/offline
wake-word model. Concretely:

- `providers/webSpeechProvider.ts`'s `privacy` field is `"remote"`, and its
  header comment states plainly that this streams audio continuously,
  whether or not "Sant" has been said yet — audio is **not** limited to
  only after the wake word.
- `wakeWord.ts`'s header repeats this explicitly and describes what a real
  local model (Prototype A) would have to do differently (run its own
  detector on raw, unprocessed audio frames, and only hand audio to a
  remote provider, if any, after a local detection fires).
- `VoicePage.tsx` shows this as a permanent, always-visible disclosure
  panel (not a dismissible tooltip), plus the live active-engine name and
  privacy value once voice is enabled — never a hardcoded claim independent
  of what's actually running.

No credential/local model was available or purchased for this round (per
plan §5); `providers/` is structured so a real local engine is a sibling
factory + one-line swap in `providers/index.ts`, without touching
`wakeWord.ts`, `commandListening.ts`, `dictation.ts`, or the UI, all of
which depend only on the `SpeechProvider` interface.

## Integration notes / deviations from a literal reading of the plan

1. **`matchPhrase` is dependency-injected, not imported, in
   `commandListening.ts`.** At the time this module was written, Worker
   2's `../commands/matcher.ts` did not exist yet (plan §4 explicitly
   anticipated this). Rather than let that block compilation of the whole
   module, `commandListening.ts` takes `matchPhrase` as a constructor
   parameter — it has **zero** dependency on `../commands/matcher`, is
   fully unit-testable against a fake, and the one real
   `import { matchPhrase } from "../commands/matcher"` lives in
   `useVoiceControl.ts` only (defaulted, overridable via
   `matchPhraseFn` for tests). **Worker 2's `matcher.ts` landed during
   this session**, so this is no longer a blocked/pending integration seam
   in practice — `tsc -b` and `vitest run` both pass clean against the
   real file (verified below) — but the injection point is left in place
   since it's also just better-tested code either way.
2. **`getCommands`/`getModes` are also caller-supplied, not a direct
   `../commands/store` import inside `useVoiceControl.ts`.** The plan's
   frozen contract only specifies `MatchPhrase`'s signature, not
   `commands/store.ts`'s export shape (that file didn't exist yet either
   when this was written). `useVoiceControl.ts` defaults both to `() =>
   []` so it stays testable standalone. **Worker 2's `store.ts` also
   landed during this session**, so `VoicePage.tsx` now wires the real
   thing: `getCommands: () => getCommandsRepository().loadCommands()`,
   `getModes: () => getCommandsRepository().loadModes()`. This is a
   read-only import of Worker 2's file, going beyond the plan's minimum
   (which only anticipated the matcher dependency) — please double-check
   this against Worker 2's actual `HANDOFF_WORKER2.md` in case their store
   shape changes before final integration.
3. **Mode/command matching passes an already wake-stripped transcript into
   `matchPhrase`**, since `wakeWord.textAfterWakeWord()` strips the leading
   "sant" before arming. Worker 2's `matchPhrase` also strips a leading
   wake-word prefix itself (`stripWakeWord`, idempotent/no-op if already
   stripped) — the two don't conflict; this was double-checked by reading
   `commands/matcher.ts` directly, not assumed.
4. **No new npm dependencies were added or requested.** Everything above
   uses only what's already in `package.json` (React, react-router-dom)
   plus browser-native APIs.

## Confirmation policy (plan §3)

Voice never has a separate "say yes to confirm" step. A `mode.activate`
match executes the same way a `navigate`/`hand_control.*` match does —
`requiresConfirmation` is metadata the registry doesn't act on itself (see
`actions/registry.ts`); the real safeguard is that a mode's voice phrase
was deliberately configured by the user in the Modes UI, where they already
reviewed the link list before saving the phrase. This is stated in the UI
copy and here, not silently glossed over.

## What was NOT tested here (no physical microphone available)

Per plan §5/§7, this environment has no real microphone. All tests above
use recorded/synthetic `SpeechTranscriptEvent`s and fakes — real speech
engine behavior, real permission prompts, and real device interruption were
never exercised end to end. **A physical-mic check should cover** (also
shown in-app on `/voice`):

- The permission prompt actually appears on first `enable()`, and denying
  it lands on an error/unavailable state, not a silent hang.
- Saying "Sant" actually arms the window (watch the state pill update
  live), and ordinary conversation never fires a command.
- **Disabling voice (or switching modes) fully releases the mic** — check
  the browser tab's mic-in-use indicator turns off. This was the explicit
  reason `microphone.ts` holds its own `getUserMedia` stream rather than
  relying on `SpeechRecognition`'s opaque internal capture — its tracks are
  real, observable, and stopped by `release()`.
- Push-to-talk (hold button, speak, release) works without saying "Sant",
  and releasing mid-sentence still finalizes whatever was captured, not
  nothing.
- Command mode and dictation never run concurrently — start one, switch
  modes mid-utterance, confirm only one mic session was ever active
  (`sessionLock.currentSessionOwner()` is a good breakpoint/log point).
- Long silence / the engine ending itself doesn't leave "enabled" silently
  deaf (`useVoiceControl`'s auto-restart-on-`onEnd` path).
- A real mic disconnect mid-session (unplug a USB mic) surfaces as an error
  rather than hanging.

## How this was verified

- `cd web && npx tsc -b` — clean, no errors, including the real
  `../commands/matcher` and `../commands/store` imports (both landed
  during this session).
- `cd web && npx vitest run` — 209/209 tests passing across 18 suites,
  including this module's 6 new test files (`microphone.test.ts`,
  `providers/webSpeechProvider.test.ts`, `wakeWord.test.ts`,
  `sessionLock.test.ts`, `commandListening.test.ts`, `dictation.test.ts`).
- `cd web && npm run build` — production build succeeds (the "chunk larger
  than 500kB" warning is pre-existing, from `react-three-fiber`/three.js,
  unrelated to this module).
- No live browser/manual check was performed (no Chrome automation was
  used for this handoff) — the checklist above is what that pass should
  cover next.

## Known limitations / honest gaps

- No genuine local wake-word model — see the honesty section above.
- The Web Speech API's exact "continuous" silence-timeout behavior varies
  by browser build; `useVoiceControl`'s auto-restart is a reasonable
  guard but wasn't verified against a real engine's actual timeout timing.
- No fuzzy/partial wake-word matching (e.g. "Zant", background-noise
  misrecognition) — `containsWakeWord` requires an exact normalized word
  match, consistent with the matcher's own "no fuzzy fallback" policy.
- `VoicePage.tsx`'s push-to-talk button only has mouse/touch handlers, not
  a keyboard-held equivalent (e.g. holding a key) — it's a real `<button>`
  so it's focusable/clickable via keyboard (Enter/Space triggers a click,
  not a press-and-hold), but true keyboard press-and-hold wasn't
  implemented since no existing app convention for that exists to mirror.
