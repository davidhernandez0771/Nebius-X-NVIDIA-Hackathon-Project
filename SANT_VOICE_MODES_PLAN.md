# SANT voice commands, custom commands, modes, and assistant chat — plan

Coordinator: this session. Branch: **`feature/sant-voice-modes`**, created
from `computer-vision` (`2e336e2`, working tree was clean) at the start of
this task. Do not create another branch, commit, push, merge, or reset —
those remain the coordinator's calls, not automatic.

## 1. Current architecture (read, not assumed)

- **Stack.** Python/FastAPI backend (`src/app`) + SQLite, React 18 +
  TypeScript + Vite frontend (`web/`), React Router. No auth — one fixed
  dev owner, local-only. Frontend talks to the backend only for
  room/photo/candidate/item/organize/chat (inventory-command) endpoints;
  this task adds **no backend endpoints** — voice, custom commands, modes
  and the new assistant chat are all client-side (local storage), by
  design (see §5 "Nebius is not connected" below).
- **Existing app pages** (`web/src/pages/`, routed in `web/src/App.tsx`
  under `DashboardShell`): Home, RoomView, AddScan, AddPhoto, Review,
  Inventory, Organize, **Chat** (an existing, already-Nebius-connected
  *inventory-command* chat at `/chat?room_id=`, backed by `/api/chat` —
  see §5, this is a **different feature** from the new "assistant chat"
  this task adds), Settings. Plus a full-bleed Landing/Entry (3D, outside
  the dashboard shell).
- **Nav pattern** (`web/src/components/DashboardShell.tsx`): a static
  `links` array of `{ to, label, icon, scoped? }`, rendered as
  `IconTile`s in a left icon rail. `IconTile` (`components/IconTile.tsx`)
  auto-applies `data-hand-dwell` to its nav-`Link` branch — any route
  added to this array is automatically dwell-activatable by the existing
  hand-control feature, no extra work needed.
- **Existing hand-controlled cursor** (`web/src/hand/**`,
  `HAND_INTERACTION_PLAN.md`, 5 revisions, all shipped and verified on
  branch `computer-vision`): an app-wide, opt-in second pointer driven by
  MediaPipe `HandLandmarker`. Its real "enable/disable" surface is
  `useHandPointer().enable()/disable()/enabled`, called from
  `web/src/hand/integration/HandToggle.tsx`, mounted once in `App.tsx`.
  **This task reuses that real toggle as a registered action** (see §3) —
  it does not reimplement hand control. **Do not touch `web/src/hand/tracking/**`,
  `web/src/hand/gesture/**`, `web/src/hand/overlay/**`, or
  `useHandPointer.ts`'s internals.** The only new file in `hand/` for this
  task is `web/src/hand/integration/handControlBridge.ts` (coordinator-owned,
  already created — a tiny registry, same pattern as the existing
  `activeScanViewer.ts`, exposing the one live `useHandPointer()` instance
  to the action registry).
- **The "shelf-camera" feature** = `AddPhoto.tsx` (upload a photo →
  `/api/photos/{id}/analyze`, a real Nebius vision call today) → `Review.tsx`
  (accept/trash/unknown each candidate). **Out of scope. Do not modify
  `AddPhoto.tsx`, `Review.tsx`, `src/app/routers/photos.py`,
  `src/app/routers/candidates.py`, or `src/app/ai/vision.py`.**
- **Persistence conventions to follow**: the hand feature already
  established the pattern this task's new local storage should copy —
  versioned-key `localStorage`, `try/catch` around every read/write
  (private browsing / quota / disabled storage must degrade to defaults,
  never throw), malformed JSON falls back to a default value rather than
  crashing. See `web/src/hand/integration/useHandPointer.ts`'s
  `loadControlRegion`/`saveControlRegion` etc. for the exact shape to
  mirror.
- **Test infra**: `web/vitest.config.ts` (Vitest + jsdom +
  `@testing-library/react`, already set up by the hand-control work — 67
  tests currently passing across 3 suites). Backend: `uv run pytest -q`,
  all AI calls mocked, never hits the network. No CI config found in-repo
  to satisfy beyond these two commands plus `tsc -b` / `vite build`.
- **Previous relevant handoff**: `HAND_INTERACTION_PLAN.md` (root of repo)
  — read it for the coordination pattern this plan follows (per-agent
  handoff files, frozen shared contracts file(s), non-overlapping paths,
  coordinator-only manifests/routing). This task's structure deliberately
  mirrors it.

## 2. What this task honestly is and isn't

- Nebius **is** connected and working for two *existing* features
  (shelf-photo vision analysis, and the inventory-command `/chat` parser)
  — the README's "Status" section and `docs/VISION_EVAL.md` are accurate
  and unaffected by this task.
- Nebius is **not** connected for the **new** assistant chat this task
  adds (Worker 3). That UI must say so honestly (see §5) — this is a new
  product surface, not a change to the two features above.
- No worker purchases services, creates provider accounts, or embeds a
  secret key in browser code. If a worker's ideal dependency needs a paid
  account/credential the user hasn't provided, they implement the best
  available documented, no-account (or free-tier, no-secret) alternative
  and say plainly in their handoff what's missing and what enabling it
  later requires — never silently downgrade a claim (see Worker 1's
  wake-word honesty requirement, §6).

## 3. Core architecture — the shared action registry

Already created (coordinator-owned, frozen — read the JSDoc in each file,
it's the real spec):

- `web/src/actions/types.ts` — `ActionDefinition`, `ActionArgs`/`ActionArgSchema`,
  `ActionContext` (`{ source, navigate }`), `ActionResult`, `ActionInputSource`
  (`"voice" | "hand" | "button" | "mode" | "chat" | "test"`).
- `web/src/actions/registry.ts` — `registerAction`, `getAction`,
  `listActions`, `validateArgs`, **`executeAction(id, args, ctx)`** — the
  one execution path for every input source. Validates args, checks
  `isAvailable()`, runs `execute()`, and turns any thrown error into a
  typed `ActionResult` instead of letting it propagate.
- `web/src/actions/builtins.ts` — `registerBuiltinActions()`, registers
  the actions that already existed before this task:
  - `navigate` (`args: { destination: NavDestination }`) — calls the real
    `react-router` `navigate()`.
  - `hand_control.enable` / `hand_control.disable` — idempotent (calling
    `enable` when already enabled is a no-op success, not an error), read
    the live `useHandPointer()` instance via
    `web/src/hand/integration/handControlBridge.ts`.
- `web/src/hand/integration/handControlBridge.ts` — tiny registry
  connecting the one `useHandPointer()` instance (mounted in `App.tsx`) to
  the actions above. Same pattern as the existing `activeScanViewer.ts`.

**`mode.activate`** (arg: `{ modeId: string }`) is registered by **Worker
2** in their own module (see §4) — it is a new action wrapping new
functionality this task builds, not a pre-existing handler, so it doesn't
belong in `builtins.ts`.

**Confirmation policy** (documented, not left ambiguous):
`requiresConfirmation` is metadata only — the registry never prompts.
`navigate` and `hand_control.*` are safe/idempotent/reversible, no
confirmation. `mode.activate` is flagged `requiresConfirmation: true`
because it can open several external tabs; the confirmation is structural
— the Modes UI always shows "contents before activation" (the task's own
requirement) as the review step when a user presses Activate by mouse/hand,
and a **voice-triggered** activation relies on the phrase having been
**deliberately configured** by the user in that same UI (where they already
saw the link list) — there is no separate interactive "say yes to confirm"
voice state machine in this version. State this plainly in the final
report; don't oversell it as a live confirmation dialog.

Inspect the app before assuming any other action exists — the three above
are the actual, real, currently-wired supported action set for this round.

## 4. File ownership (exclusive, non-overlapping)

### Coordinator (this session) — already created / integrates last

`web/src/actions/types.ts`, `web/src/actions/registry.ts`,
`web/src/actions/builtins.ts`, `web/src/hand/integration/handControlBridge.ts`,
`web/src/commands/types.ts`, `web/src/voice/types.ts`,
`web/src/components/Icon.tsx` (added `mic`/`wand`/`layers`/`sparkle`
glyphs, already done), `web/src/App.tsx`, `web/src/components/DashboardShell.tsx`,
`web/package.json`, `web/package-lock.json`, `.gitignore`, this file.
**Workers must not edit these** — importing from them is expected and
required; if one is genuinely insufficient, say so in your handoff, don't
silently change it.

### Worker 1 — Voice input and command recognition

Owns everything in `web/src/voice/` **except** `voice/types.ts` (frozen,
coordinator-owned contract, read-only import):

- `web/src/voice/microphone.ts` — one coordinated mic lifecycle (permission
  request/denial, device-missing, interruption, cleanup).
- `web/src/voice/providers/` — speech-provider adapter(s) behind a small
  interface you define, so a real wake-word engine can replace the
  transcription-based prototype later without touching the rest of the
  module.
- `web/src/voice/wakeWord.ts` — "Sant" detection (see §6 for the
  A-vs-B honesty requirement) and the short armed command window.
- `web/src/voice/commandListening.ts` — wake → transcribe → finalize →
  `matchPhrase()` (import from `../commands/matcher`, Worker 2's file,
  read-only) → `executeAction()` (import from `../actions/registry`,
  read-only) → result/error surfaced to the UI. Never executes on an
  interim transcript.
- `web/src/voice/dictation.ts` — implements `UseDictation` from
  `./types.ts` exactly (function shape frozen; internals are yours).
  Dictation is a separate speech session from command-listening — the two
  must never run concurrently; spoken command phrases while dictating
  insert as text, they do not execute.
- `web/src/voice/useVoiceControl.ts(x)` — top-level hook/state machine
  wiring the above into `VoiceListeningState`.
- `web/src/voice/VoicePage.tsx` — the `/voice` page: enable/disable voice,
  push-to-talk button, visible state (`VoiceListeningState`), recognized
  phrase + matched action/command display, mode toggle (command ⇄
  dictation), browser/limitation notices.
- Tests: colocated `*.test.ts` using recorded/synthetic transcript events
  for interpretation/state-machine logic — clearly separate these from
  anything that needs a live microphone (which you cannot run here; note
  it, don't fake a pass).

Handoff: `web/src/voice/HANDOFF_WORKER1.md`.

### Worker 2 — Custom commands and modes

Owns everything in `web/src/commands/` **except** `commands/types.ts`
(frozen, coordinator-owned contract, read-only import):

- `web/src/commands/store.ts` — versioned `localStorage` adapter for
  `SavedCommand[]` and `Mode[]` (`COMMANDS_STORAGE_VERSION` /
  `MODES_STORAGE_VERSION` from `types.ts`), behind a small interface (so a
  later personal/workspace backend can swap in without a UI rewrite — do
  not build that backend now). Malformed data recovers to empty, never
  throws. Import/export (JSON) if it's straightforward — skip if it adds
  real complexity, note the decision.
- `web/src/commands/matcher.ts` — implements `MatchPhrase` from
  `types.ts` exactly: normalize case/punctuation/whitespace, strip the
  `WAKE_WORD` prefix (the same constant Worker 1's wake-word detector
  arms on — import it from `commands/types.ts`, don't hardcode `"sant"`
  again), resolve phrase/alias against enabled commands and modes, detect
  conflicts. No fuzzy nearest-match fallback — unmatched is `"unknown"`,
  never a guess.
- `web/src/commands/modes.ts` — mode-execution logic: launch each
  `ModeLink` in order, `window.open()` for external (validate URL/scheme
  first — reject anything but `http(s):`), `navigate()`-based for
  internal; a **launch-result model** per link (opened / blocked / error)
  since a voice-recognition callback does not reliably authorize
  `window.open()` — report this accurately, with an individually usable
  fallback link/retry per blocked item, not a claim that every tab opened.
  Duplicate-launch guard so a repeated speech/click event can't re-fire
  the same activation. Never closes or touches tabs the app didn't open
  itself.
- `web/src/commands/registerActions.ts` — `registerModeActivateAction()`,
  registers `mode.activate` (see §3) via `registerAction` from
  `../actions/registry` (read-only import); calls into `modes.ts`.
  Coordinator calls this once from `App.tsx` during integration.
- `web/src/commands/CommandsPage.tsx` (`/commands`) — create/edit/enable-
  disable/delete, phrase + aliases + action + validated args, "When I say
  …, Sant will …" preview, conflict detection (incl. against mode
  phrases), a "test" button that runs the real action through
  `executeAction()` with normal `isAvailable`/confirmation behavior (never
  a special-cased test path that skips checks).
- `web/src/commands/ModesPage.tsx` (`/modes`) — create/edit/duplicate/
  delete/activate, ordered link list (external/internal, validated),
  optional voice phrase (through the same command-matching pipeline, not
  a second system), show contents before activation, per-link launch
  result after activating, accessible mouse/keyboard controls (real
  buttons/roles, not hand/voice-only).
- Tests: colocated `*.test.ts`, especially `matcher.ts` (normalization,
  wake-prefix stripping, alias/conflict resolution, unknown vs. ambiguous)
  and `modes.ts` (launch-result model, duplicate-launch guard, URL/scheme
  validation).

Handoff: `web/src/commands/HANDOFF_WORKER2.md`.

### Worker 3 — Assistant chat interface

Owns everything in `web/src/assistant/` (no frozen sub-file — this
directory has no other consumer this round):

- `web/src/assistant/types.ts` — your own types (conversation, message,
  draft-vs-submitted, provider states). Not shared with anyone else.
- `web/src/assistant/providerAdapter.ts` — a `Provider` interface
  supporting streaming replies and cancellation (e.g.
  `send(messages, { signal }): AsyncIterable<Chunk>` or equivalent — your
  call, keep it small), plus the **only implementation this round**: a
  `NotConnectedProvider` that never fabricates a reply — it returns/throws
  a typed "Nebius not connected" result immediately. Real Nebius wiring is
  explicitly out of scope (§2). Keep optional dev-preview fixtures (if
  you add any) clearly labeled as fixtures, never indistinguishable from a
  real reply.
- `web/src/assistant/messageStore.ts` — local persistence for
  conversations/messages, same versioned-`localStorage`/malformed-data-
  recovers convention as Worker 2's `commands/store.ts` (mirror it, don't
  invent a third pattern). Drafts (unsent composer text) persist and
  survive a disconnected/error state — never silently discarded on send
  when the provider is unavailable; show the failure and keep the draft.
- `web/src/assistant/ConversationList.tsx`, `MessageComposer.tsx`
  (multiline, accessible send button, mic button via `useDictation` from
  `../voice/dictation` — **read-only import**, Worker 1's file — wired so
  finalized dictated text lands in the composer without auto-sending),
  message history rendering with clear disconnected/loading/error/
  cancelled states.
- `web/src/assistant/AssistantPage.tsx` (`/assistant`) — composes the
  above; visually reuse the app's existing glass/dark language
  (`GlassCard`, `Zones`, `StatusPill`, `tokens.css` — same components the
  rest of the dashboard uses, don't invent a new visual system). Anime.js
  for restrained transitions only, respect `prefers-reduced-motion`.
- Future chat-driven actions stay behind the shared action registry — do
  not let chat text (or, later, a model reply) call `executeAction()`
  directly from this module; that wiring, when it exists, is a deliberate
  future integration point, not something to half-build now.
- **Do not touch** `AddPhoto.tsx`, `Review.tsx`, or anything under
  `src/app/routers/photos.py` / `candidates.py` (shelf-camera, §1) — this
  is a distinct feature, and **do not touch `web/src/pages/Chat.tsx`**
  either — that is the existing, separately-Nebius-connected inventory-
  command chat; leave it exactly as is.
- No client-side API-key field, no secret in browser code, anywhere.

Tests: colocated `*.test.ts` (message store recovery, draft persistence,
provider-not-connected state, composer duplicate-insertion-from-dictation
guard).

Handoff: `web/src/assistant/HANDOFF_WORKER3.md`.

## 5. Nebius / credentials / browser limitations (read before starting)

- No worker needs a Nebius key for this task. The backend's existing
  `NEBIUS_API_KEY` (`.env`, git-ignored, server-side only) is untouched
  and irrelevant to voice/commands/modes/assistant-chat.
- Worker 1: browser speech APIs (e.g. the Web Speech API,
  `SpeechRecognition`/`webkitSpeechRecognition`) are **not local** —
  Chrome's implementation sends audio to Google's servers for
  transcription; there is currently no bundled offline wake-word model in
  this repo (unlike the hand feature's locally-hosted MediaPipe WASM/model
  assets). If you use it, or any similar remote transcription API, say so
  explicitly and do not describe it as local/private. Prefer a
  replaceable adapter (§4) so a real local wake-word engine (e.g.
  Porcupine or a similar on-device model) can be swapped in later without
  this being a rewrite — do not sign up for one now.
- Worker 3: real Nebius chat/vision integration is out of scope end to
  end (§2) — the provider boundary is the deliverable, not a working
  connection.
- Physical microphone/webcam testing is not possible in this environment
  (same limitation the hand-control work already hit for its camera).
  Simulate with recorded/synthetic events for logic tests, and give the
  user an explicit real-hardware checklist in your handoff instead of
  claiming untested behavior works.

## 6. Worker 1's wake-word honesty requirement (binding)

Distinguish, explicitly, in code comments and the final handoff:

- **A.** A genuine local wake-word model that detects "Sant" without
  sending continuous audio anywhere.
- **B.** A prototype that recognizes "Sant" inside continuously
  transcribed speech (e.g. via a remote browser speech API).

Do not label B as A. Do not claim only post-wake audio leaves the device
if the selected provider continuously streams audio to a server. If no
credential/local model is available (expected — see §5), implement B
plus push-to-talk, and say plainly in the UI and handoff which one is
running.

## 7. Test commands (run after your module lands, and again by the coordinator at the end)

```
cd web && npx tsc -b
cd web && npm run build
cd web && npx vitest run        # or: npm test
```

Backend is untouched by this task; `uv run pytest -q` from the repo root
is expected to be unaffected, but the coordinator re-runs it once at the
end as a cheap sanity check, not per-worker.

## 8. Integration order (coordinator, after all three handoffs land)

1. Read all three handoff files and the actual code (not just the
   handoffs) before making any integration edit.
2. Resolve any ownership-boundary conflicts before touching shared files.
3. `App.tsx`: add routes `/voice`, `/commands`, `/modes`, `/assistant`
   (lazy or eager, matching the existing convention for dashboard pages);
   mount `registerBuiltinActions()` and Worker 2's
   `registerModeActivateAction()` once at startup; wire
   `registerHandControlBridge(...)` from the existing `useHandPointer()`
   instance (mirroring how `activeScanViewer.ts` is populated elsewhere).
4. `DashboardShell.tsx`: add nav entries (Voice/`mic`, Commands/`wand`,
   Modes/`layers`, Assistant/`sparkle` — icons already added to
   `Icon.tsx`).
5. Verify: voice → matcher → `executeAction()` → real
   `hand_control.enable` actually flips `useHandPointer().enabled`; a
   saved mode phrase reaches `mode.activate`; dictation lands in the
   assistant composer without auto-send or command execution; disabling
   voice fully releases the mic (check via `getUserMedia` track state in
   a manual browser check, same rigor as the hand feature's camera
   cleanup checks).
6. Run §7's commands clean, plus one backend `uv run pytest -q` pass.
7. Manual browser check (Chrome automation available, no physical
   mic/camera here) against the 11 acceptance checks in the original
   task prompt; report physical-mic items separately as a checklist for
   the user, exactly as the hand-control work did for the camera.
8. Final handoff to the user per the original prompt's required format.

## 9. Status

**Complete and integrated.** All three workers landed (see their handoff
files: `web/src/voice/HANDOFF_WORKER1.md`, `web/src/commands/HANDOFF_WORKER2.md`,
`web/src/assistant/HANDOFF_WORKER3.md`). Coordinator wired routes
(`/voice`, `/commands`, `/modes`, `/assistant`) and nav entries into
`App.tsx`/`DashboardShell.tsx`, called `registerBuiltinActions()` and
`registerModeActivateAction()` at bootstrap, and wired the real
`useHandPointer()` instance into `handControlBridge`.

One coordinator-introduced bug was found and fixed during integration: an
initial `useEffect` cleanup on the hand-control bridge registration was
nulled out by React 18 StrictMode's dev-mode double-invoke (mount →
cleanup → mount), since nothing re-registered it on the simulated
remount — `hand_control.enable`/`disable` reported "not available" as a
result. Fixed by removing the cleanup effect (registration already
happens fresh every render, so it wasn't needed) and re-verified live in
a real browser: Commands → Test on a `hand_control.enable` command now
correctly flips the real `HandToggle` button.

`cd web && npx tsc -b`, `npx vitest run` (209/209 across 18 suites), and
`npm run build` are all clean. Manual browser verification (Chrome
automation, no physical mic/camera) confirmed: all 4 new nav entries and
pages render with no console errors; a saved `hand_control.enable`
command's Test button flips the real hand-control toggle end to end;
`javascript:` URLs are rejected in Modes; the review-then-confirm
Activate flow works; the Assistant page honestly shows "Nebius not
connected" and preserves the draft on a failed send; settings persist
across a reload. Backend `uv run pytest -q` shows 49 pre-existing
failures unrelated to this task (zero Python files touched) — Windows/
OneDrive environment drift (`HOME`-based path expansion, `.pytest_cache`
"Access is denied"), not something this task introduced or fixed.

Not verified (no physical microphone in this environment) — see the
real-camera-style checklists in each worker's handoff, especially
`HANDOFF_WORKER1.md`'s.
