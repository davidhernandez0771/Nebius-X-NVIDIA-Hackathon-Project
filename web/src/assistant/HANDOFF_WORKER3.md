# Worker 3 handoff — Assistant chat interface

Scope: `web/src/assistant/` (§4 of `SANT_VOICE_MODES_PLAN.md`). New route
`/assistant`, a general-purpose chat surface, distinct from the existing
Nebius-connected inventory-command chat at `web/src/pages/Chat.tsx` (not
touched — verified untouched at handoff time).

## What was built

- **`types.ts`** — `AssistantMessage` (`role`, `status`, optional
  `errorMessage`), `AssistantConversation`, `AssistantState`. Own types,
  not shared with any other worker's module.
- **`providerAdapter.ts`** — `Provider` interface (`send(messages,
  { signal }): AsyncIterable<ProviderChunk>`, streaming + cancellation via
  `AbortSignal`), a typed `ProviderError` (`not_connected | cancelled |
  unknown`), and:
  - `NotConnectedProvider` — the only provider actually used by
    `AssistantPage`. Throws `ProviderError("not_connected", …)` the moment
    it's asked to answer; never yields a chunk first. Verified by test
    (`providerAdapter.test.ts`) that no chunk is ever produced before the
    throw, including the already-aborted-signal path.
  - `FixtureProvider` — **not wired into the app anywhere**, dev-only, every
    reply is prefixed `[DEV FIXTURE -- not a real reply, Nebius not
    connected]` so it can never be mistaken for a real answer. Exists only
    so the streaming/complete UI states can be sanity-checked visually
    later; delete it freely if unwanted.
- **`messageStore.ts`** — versioned (`sant.assistant.state`, version 1)
  `localStorage` persistence, pure functions only (`load`/`save` +
  `createConversation`/`deleteConversation`/`addMessage`/`updateMessage`/
  `setDraft`/`getDraft`). Mirrors
  `hand/integration/useHandPointer.ts`'s `loadControlRegion`/
  `saveControlRegion` convention: every read/write wrapped in try/catch,
  malformed/unversioned data recovers to an empty state, storage errors
  degrade silently rather than throwing.
- **`useAssistantChat.ts`** (not in the original file list, added as an
  implementation detail — the directory has no frozen sub-file this round
  so this was mine to add) — the React state layer wiring `messageStore`
  and a `Provider` together: conversation CRUD, `send()`/`cancel()`,
  streaming updates into the store as chunks arrive. **A failed/disconnected
  send never clears the draft** — the draft is only cleared on a genuinely
  successful reply (plan §4's "keep the draft" requirement); since the only
  provider wired in is `NotConnectedProvider`, in this build every send
  ends in an `error`-status assistant message and the draft is always
  preserved. The user's own text is still recorded as a real `"sent"` user
  message in history either way — never silently dropped.
- **`ConversationList.tsx`** — list/select/new/delete conversations.
- **`MessageComposer.tsx`** — multiline `<textarea>`, Enter-to-send /
  Shift+Enter-for-newline, accessible send button (`aria-label="Send
  message"`, disabled when empty or sending; swaps to a "Stop" button that
  calls `onCancel` while sending), and a mic button wired to `useDictation`
  from `../voice/dictation` (Worker 1's file — read-only import, landed
  during this session; verified its `active` boolean is the real control
  surface, `start`/`stop` on the returned controller are intentionally
  unused here). Dictation duplicate-insertion guard: each `onText(text,
  isFinal)` call **replaces** the portion of the composer text appended
  after a per-utterance snapshot, rather than appending on every call —
  required because interim Web Speech results repeat the whole
  utterance-so-far, not a delta. Finalized text lands in the box without
  calling `onSend`.
- **`AssistantPage.tsx`** (`/assistant`) — composes the above inside
  `Zones`/`GlassCard`/`StatusPill` (no new visual system). A `StatusPill`
  always reads "Nebius not connected" (warm tone) since `providerConnected`
  is `false`. New messages get a restrained Anime.js fade/slide-in
  (`animate(lastElementChild, { opacity, translateY, duration: 260 })`),
  skipped entirely when `prefers-reduced-motion` is set (reusing
  `../three/capability`'s `prefersReducedMotion()`, the same helper
  `Entry.tsx`/`Landing.tsx` already use).
- **`assistant.css`** — scoped stylesheet colocated in this directory (same
  pattern as `hand/integration/handToggle.css`), referencing only existing
  tokens from `../tokens.css`. The shared `styles.css` was deliberately left
  untouched to avoid any collision with the other two workers editing pages
  concurrently.

## Deviations from the plan, and why

- Added `useAssistantChat.ts` beyond the plan's explicit file list. The
  plan states the `assistant/` directory has no frozen sub-file this round,
  so this was within scope; it exists to keep `AssistantPage.tsx` a thin
  composition layer and to make the provider-not-connected/draft-survival
  logic independently testable without rendering the page.
- Added `FixtureProvider` (not plan-required, explicitly allowed as an
  optional labeled dev fixture per §4) but never registered it as the
  page's provider — confirmed by reading `AssistantPage.tsx`: it calls
  `useAssistantChat()` with no `provider` override, so the default
  `NotConnectedProvider` is what actually runs.
- `MessageComposer`/`AssistantPage` do not import `../voice/dictation`'s
  `start`/`stop` — only `active`. Confirmed by reading Worker 1's
  `dictation.ts`: it already starts/stops the mic session internally off
  the `active` boolean via its own `useEffect`, so calling `start`/`stop`
  from here as well would be redundant, not required.

## Known issues / not done

- No real Nebius wiring — intentional, out of scope this round (plan §2/§5).
- No message editing/regeneration/retry-in-place UI; a failed send's error
  is shown and the draft is preserved, but there's no dedicated "Retry"
  button — the user re-presses Send.
- Conversation titles are static ("New conversation") — no auto-naming from
  content, since there's no model to summarize with.
- `MessageComposer`'s `onText` callback identity can change across renders
  when the assistant's own state updates elsewhere (e.g. `sending`
  flipping) because `useAssistantChat`'s `setDraft` isn't a fully stable
  reference. This doesn't break the duplicate-insertion guard (verified by
  test) since the guard's snapshot lives in a ref, not the callback
  identity, but flagging it as a minor inefficiency, not a correctness bug.
- No client-side API key field or secret anywhere in this module —
  confirmed by inspection, nothing here does network I/O at all.

## Cross-worker note

`web/src/voice/dictation.ts` did not exist at task start (Worker 1 was
still writing it); it landed mid-session. Re-verified after it appeared
that `useDictation`'s real shape matches the frozen `UseDictation` contract
in `voice/types.ts` and that my usage (`active` only) is correct against
the real implementation, not just the type. `web/src/commands/ModesPage.tsx`
currently fails `npm run build`'s `tsc -b` step with `'normalizePhrase' is
declared but its value is never read` (TS6133) — that's Worker 2's file,
outside this handoff's scope, not touched or fixed here.

## How this was verified

- `cd web && npx tsc -b --force` — clean, no errors, across the whole
  project (re-checked after Worker 1's `dictation.ts` landed).
- `cd web && npx vitest run` — **160/160 tests pass** across all 11 suites
  (project-wide, not just this module): `messageStore.test.ts` (15,
  malformed-data recovery incl. bad JSON, wrong version, non-object
  payloads, storage-throws, draft persistence/round-trip/deletion-cascade,
  CRUD), `providerAdapter.test.ts` (4, not-connected error, no chunk before
  throw, already-aborted-signal), `useAssistantChat.test.ts` (4,
  provider-not-connected end state, draft survives a failed send, honest
  `providerConnected`/`providerId`, empty-draft send is a no-op),
  `MessageComposer.test.tsx` (7, dictation replace-not-append across
  interim/final, no auto-send on finalized dictation, second utterance
  appends correctly after the first is finalized, manually-typed text isn't
  duplicated by a following dictation, mic toggle drives `active` correctly,
  send-button disabled/Stop-button-swap states, Enter vs Shift+Enter).
- `cd web && npm run build` — `vite build` itself was not reached because
  `tsc -b` currently fails on Worker 2's `ModesPage.tsx` (see above, not my
  file). Re-run this once that's fixed; nothing in `src/assistant/` is
  implicated in that failure.
- Not run: a live browser check with a real microphone (this environment
  has no physical mic/camera — same limitation noted in the plan for the
  hand-control work). Manual checklist for the user:
  - [ ] `/assistant` loads once routed in `App.tsx`/`DashboardShell.tsx`
        (coordinator integration step, not done by this worker).
  - [ ] Typing + Enter sends; the message appears, followed immediately by
        an assistant message reading "Nebius is not connected…", and the
        composer's draft is **not** cleared.
  - [ ] Pressing the mic button, speaking, and stopping lands the
        transcribed text in the composer without sending it.
  - [ ] Reloading the page after typing an unsent draft (without pressing
        send) restores that draft text.
  - [ ] `prefers-reduced-motion: reduce` (OS setting) suppresses the
        message fade-in animation.
