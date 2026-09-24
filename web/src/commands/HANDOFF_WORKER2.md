# Worker 2 handoff — Custom commands and modes

Scope: everything under `web/src/commands/` except the frozen `types.ts`
(coordinator-owned contract, read-only import). See `SANT_VOICE_MODES_PLAN.md`
§4 for the assignment this implements.

## What was built

- **`store.ts`** — `CommandsRepository` interface (`loadCommands`/`saveCommands`/
  `loadModes`/`saveModes`) behind `getCommandsRepository()`/
  `setCommandsRepository()` so a future personal/workspace backend can swap in
  without touching the pages. The real implementation,
  `localStorageCommandsRepository`, stores `{ version, items }` under
  `sant.commands` and `sant.modes`, checked against `COMMANDS_STORAGE_VERSION`/
  `MODES_STORAGE_VERSION` from `types.ts` on load. Malformed JSON, a version
  mismatch, or an individually malformed item all fall back silently (empty
  list, or that one item dropped) — never throws, mirroring
  `hand/integration/useHandPointer.ts`'s `loadControlRegion`/`saveControlRegion`.
  Also exports `generateId`, `upsertCommand`/`removeCommand`,
  `upsertMode`/`removeMode` (pure array helpers used by both pages), and a thin
  `exportAll()`/`importAll()` JSON round-trip (see "Deviations" below).

- **`matcher.ts`** — implements `MatchPhrase` from `types.ts` exactly.
  `normalizePhrase` lowercases, strips punctuation, collapses whitespace;
  `stripWakeWord` removes a leading `WAKE_WORD` token if present (safe to call
  on a transcript that never had it). `matchPhrase` normalizes + strips, then
  looks for an **exact** match against every enabled command's phrase/aliases
  and every mode's optional phrase — no fuzzy/closest-guess fallback, ever; no
  match is `"unknown"`, more than one distinct command/mode matching the same
  normalized text is `"ambiguous"` (deduplicated candidate names). Also
  exports `findPhraseConflicts(phrase, commands, modes, exclude?)`, the
  save-time check both editor pages use so the runtime `"ambiguous"` branch
  stays a rare fallback instead of the normal path.

- **`modes.ts`** — `launchMode(mode, navigate, now?)` launches every
  `ModeLink` in order and returns a per-link `LinkLaunchResult`
  (`opened`/`blocked`/`error`) plus `allOpened` (true only when every link
  actually opened). `validateModeLink` rejects anything but `http:`/`https:`
  for external links (checked again here, not just at save time) and requires
  internal links to start with `/`. External links use
  `window.open(url, "_blank", "noopener,noreferrer")`; a `null` return (popup
  blocked) is reported as `"blocked"`, never silently swallowed or claimed as
  success. A duplicate-launch guard (1.5s window, keyed per `modeId`) stops a
  repeated speech-recognition final event or double click from re-firing the
  same activation. `launchLink` (exported) launches exactly one link,
  independent of that guard — it's what a per-link "Retry" button calls.
  Never calls `window.close()` or otherwise touches a tab it didn't just open.

- **`registerActions.ts`** — `registerModeActivateAction()` registers
  `mode.activate` (`args: { modeId: string }`, `requiresConfirmation: true`)
  via `registerAction` from `../actions/registry`. `execute()` looks the mode
  up fresh from the repository (not a stale closure), calls `launchMode`, and
  turns the per-link results into one `ActionResult`: `ok:false` only if
  *zero* links opened, `ok:true` with an honest "opened N of M" message
  otherwise — it never claims full success when some links were blocked.
  Idempotent registration, same pattern as `builtins.ts`. The coordinator
  calls this once from `App.tsx` per the plan; I did not call it myself from
  app code.

- **`CommandsPage.tsx`** (`/commands`, not yet routed — see "What I didn't
  do") — create/edit/enable-disable/delete `SavedCommand`s. The action
  dropdown and per-action argument fields are generated entirely from
  `listActions()`'s `ActionArgSchema` (string+enum → select, string → text,
  number → number input with min/max, boolean → the existing `Toggle`) — no
  action-specific UI code. Save is blocked (not just warned) on: empty
  name/phrase, an alias identical to the phrase, a schema-arg validation
  failure (`validateArgs`, the same function `executeAction` itself calls),
  or a phrase/alias conflict against any other *enabled* command or any mode
  phrase (`findPhraseConflicts`) — shown live while typing, not just on
  submit. The "When I say ... Sant will ..." preview reflects the live form
  state. "Test" runs the real `executeAction(command.actionId, command.args,
  { source: "test", navigate })` — normal `isAvailable`/arg-validation
  applies, there's no test-only bypass — and shows the returned
  `ActionResult` inline.

- **`ModesPage.tsx`** (`/modes`, not yet routed) — create/edit/duplicate/
  delete `Mode`s with an ordered link list (add/remove/reorder via real
  `<button>`s with `aria-label`s, keyboard-operable, no hand/voice-only
  affordance). Each link is validated with `validateModeLink` before it's
  added. The optional voice phrase runs through the same
  `findPhraseConflicts` pipeline as commands (checked against all commands
  *and* other modes). **Activation is two-step by construction**: pressing
  "Activate" opens an inline review ("Activating will open these N links, in
  order") that must be explicitly confirmed before `launchMode` actually
  runs — this is the structural confirmation the plan calls for in §3, since
  `mode.activate`'s `requiresConfirmation` flag is metadata the registry
  itself never enforces. After activation, every link gets its own
  opened/blocked/error pill; a blocked/error link gets an individual "Retry"
  button (`launchLink`, not a full re-activation). "Duplicate" deep-copies a
  mode with new ids and clears the copy's phrase so it can never
  immediately conflict with the original.

## Tests

Colocated, run via `cd web && npx vitest run src/commands`:

- `matcher.test.ts` (23 tests) — normalization, wake-word stripping
  (present/absent/lone-word/false-positive like "santa"), alias matching,
  disabled-command exclusion, mode-phrase matching, unknown-vs-ambiguous,
  `findPhraseConflicts` (self-exclusion, disabled exclusion, empty-phrase
  no-op).
- `modes.test.ts` (17 tests) — `validateModeLink` (http/https accepted,
  javascript:/data: rejected, internal path shape), `launchLink` (navigate
  called, `window.open` args, blocked-popup reporting, invalid scheme never
  reaches `window.open`), `launchMode` (order preserved, `allOpened`
  semantics including the zero-links case, duplicate-launch guard timing —
  within window / past window / independent per mode id).
- `store.test.ts` (14 tests) — round-trip, empty-when-unset, malformed-JSON
  recovery, version-mismatch recovery, per-item malformed-entry filtering,
  upsert/remove helpers, `exportAll`/`importAll` including "missing key
  leaves existing data untouched."
- `CommandsPage.test.tsx` / `ModesPage.test.tsx` (5 + 6 tests, jsdom +
  `@testing-library/react`) — added as a stand-in for a live browser check,
  since `/commands` and `/modes` aren't wired into `App.tsx`'s router yet
  (that's the coordinator's integration step, plan §8). Covers: create →
  appears in list; conflicting phrase blocks save with the real message;
  Test button runs the real `executeAction` and shows its result; toggling
  enabled and deleting both persist; adding a link with an unsafe scheme is
  rejected before it's stored; the review-then-confirm activation flow; a
  blocked popup shows Retry and retry recovers it; duplicate clears the
  phrase.

**65/65 tests pass.** `cd web && npx tsc -b` is clean for everything this
module touches (see "Known issues, not mine" below for the one pre-existing
unrelated error). I did not run `npm run build` end-to-end since it currently
fails on Worker 1's/3's in-progress files for reasons outside this module
(see below) — not something I can fix from here.

## Deviations from the plan, and why

- **Import/export UI was not built**, only the primitives
  (`exportAll()`/`importAll()` in `store.ts`, both tested). The plan
  explicitly allows skipping this "if it adds real complexity" — a working
  download/file-picker UI across two pages felt like more surface area than
  this round's value justified, especially with three sessions editing the
  repo concurrently. The functions are there and tested for whoever wants to
  wire a button to them later.
- **I did not touch `styles.css`/`tokens.css`.** Only `input[type=text]` gets
  full glass styling from the existing global CSS — `<select>` and
  `<textarea>` currently fall back to bare browser styling. Rather than edit
  the shared stylesheet (real risk of clobbering a concurrent edit from
  Worker 1's `VoicePage` or Worker 3's `AssistantPage`, since none of us are
  in separate git worktrees), I styled my own `<select>` elements inline
  using the existing CSS custom properties (`var(--surface)`,
  `var(--border)`, `var(--radius-control)`, etc.) so they still look
  on-brand without a shared-file edit. If a later pass wants to promote that
  to a real `select`/`textarea` rule in `styles.css`, the values are already
  there to copy.
- **`mode.activate`'s `ActionResult` is intentionally coarser than what
  ModesPage shows.** `ActionResult` is `{ ok, message | error }` — one
  string. Voice/test/chat callers get that coarse summary
  ("opened 2 of 3 links..."). `ModesPage` itself calls `launchMode`/
  `launchLink` directly (not through `executeAction`) so it can render the
  full per-link result list and individual retries — same pattern as
  `hand_control.enable` wrapping `handControlBridge` while
  `CalibrationPanel` calls the bridge's own richer methods directly.

## Known issues / not mine

Running the full suite (`cd web && npx vitest run`) shows 208/209 passing
outside `src/commands/**` — the one failure
(`src/voice/providers/webSpeechProvider.test.ts`) and one `tsc -b` error
(`src/voice/microphone.test.ts(7,21): 'beforeEach' declared but never read`)
are both in Worker 1's in-progress files, not mine — flagging so the
coordinator doesn't mistake them for something this handoff introduced.
Likewise `npx tsc -b` reports `src/assistant/MessageComposer.tsx` failing to
resolve `../voice/dictation` — that's Worker 3 depending on a Worker 1 file
that doesn't exist yet, unrelated to anything under `commands/`.

## What I didn't do (out of scope, per the plan)

- Did not add `/commands` or `/modes` to `App.tsx`'s routes, and did not add
  nav entries to `DashboardShell.tsx` — both coordinator-owned, integration
  step in plan §8.
- Did not call `registerModeActivateAction()` from anywhere myself — the
  coordinator wires it into `App.tsx`'s startup alongside
  `registerBuiltinActions()`.
- Did not touch `commands/types.ts`, any file under `voice/` or `assistant/`,
  `hand/**`, `AddPhoto.tsx`/`Review.tsx`, or any shared manifest.

## How to verify (for the coordinator, after routing lands)

1. `cd web && npx tsc -b && npx vitest run src/commands` — should be clean.
2. Visit `/commands`: add a command targeting `hand_control.enable`, hit
   Test, confirm it flips the real hand-cursor toggle (or reports
   "isn't available" if the hand-control bridge isn't mounted on that page —
   expected, matches `isAvailable`'s contract).
3. Try adding a second command with the same phrase — save should be
   blocked with a conflict message naming the first one.
4. Visit `/modes`: build a mode with one internal link (`/inventory`) and one
   external link (any `https://` URL), give it a voice phrase, Activate —
   confirm the review step appears before anything opens, and that both
   links report "Opened" (a real click, so popups shouldn't be blocked here;
   if the browser blocks it anyway, the Retry button should recover it).
5. Say the mode's phrase through the voice pipeline (once Worker 1's
   `commandListening.ts` is wired) and confirm it reaches `mode.activate` via
   `executeAction`, with a summarized (not per-link) result.
