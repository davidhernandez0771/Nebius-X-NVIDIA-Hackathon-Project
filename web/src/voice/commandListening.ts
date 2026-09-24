// wake -> transcribe -> finalize -> matchPhrase() -> executeAction(), plus
// the manual push-to-talk path (arm without a wake word). Deliberately
// takes `matchPhrase` as a constructor dependency rather than importing
// `../commands/matcher` directly: that file is Worker 2's, written in
// parallel and not yet landed (see SANT_VOICE_MODES_PLAN.md §4), so this
// module is fully testable today against a fake, and the one real
// `../commands/matcher` import lives in useVoiceControl.ts only -- see that
// file's header and HANDOFF_WORKER1.md for the integration note.
//
// Never executes on an interim transcript: buffer updates freely while
// armed, but matchPhrase()/executeAction() only run on a finalized
// transcript (isFinal, a window timeout, or an explicit finalizeNow()).

import { executeAction } from "../actions/registry";
import type { ActionArgs, ActionResult } from "../actions/types";
import type { MatchPhrase, MatchResult, Mode, SavedCommand } from "../commands/types";
import type { RecognizedCommandEvent, VoiceListeningState } from "./types";
import type { SpeechTranscriptEvent } from "./providers/types";
import { containsWakeWord, textAfterWakeWord, COMMAND_WINDOW_MS } from "./wakeWord";

export interface CommandListenerDeps {
  matchPhrase: MatchPhrase;
  getCommands: () => SavedCommand[];
  getModes: () => Mode[];
  navigate: (to: string) => void;
  /** Defaults to wakeWord.COMMAND_WINDOW_MS. Overridable for tests so they don't need real timers. */
  commandWindowMs?: number;
  /** Injectable timer, for tests. Defaults to the real setTimeout/clearTimeout. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface CommandListenerEvents {
  onStateChange: (state: VoiceListeningState) => void;
  onRecognized: (event: RecognizedCommandEvent) => void;
  onResult: (result: ActionResult) => void;
}

export interface CommandListener {
  /** Feed one transcript chunk from the active SpeechProvider. Only meaningful while the caller's mic session is running -- the caller (useVoiceControl) is responsible for never invoking this during dictation. */
  handleTranscript: (event: SpeechTranscriptEvent) => void;
  /** Arms the command window immediately, without requiring the wake word -- the push-to-talk path. */
  armManually: () => void;
  /** Force-finalizes whatever has been heard so far in the current window (push-to-talk release). No-op if not armed. */
  finalizeNow: () => void;
  /** Cancels any in-flight window and returns to a clean, unarmed state -- used on disable(). */
  reset: () => void;
}

function toRecognizedEvent(transcript: string, result: MatchResult): RecognizedCommandEvent {
  if (result.status === "matched" && result.kind === "command") {
    return { transcript, matchedActionId: result.command.actionId, matchedLabel: result.command.displayName };
  }
  if (result.status === "matched" && result.kind === "mode") {
    return { transcript, matchedActionId: "mode.activate", matchedLabel: result.mode.name };
  }
  return { transcript, matchedActionId: null, matchedLabel: null };
}

export function createCommandListener(deps: CommandListenerDeps, events: CommandListenerEvents): CommandListener {
  const windowMs = deps.commandWindowMs ?? COMMAND_WINDOW_MS;
  const scheduleTimeout = deps.setTimeoutFn ?? setTimeout;
  const cancelTimeout = deps.clearTimeoutFn ?? clearTimeout;

  let armed = false;
  let buffer = "";
  let windowHandle: ReturnType<typeof setTimeout> | null = null;

  function clearWindow(): void {
    if (windowHandle !== null) {
      cancelTimeout(windowHandle);
      windowHandle = null;
    }
  }

  function arm(seedText: string): void {
    armed = true;
    buffer = seedText;
    clearWindow();
    windowHandle = scheduleTimeout(() => {
      void finalize();
    }, windowMs);
    events.onStateChange(seedText ? "transcribing" : "wake-detected");
  }

  function disarm(): void {
    armed = false;
    buffer = "";
    clearWindow();
  }

  async function finalize(): Promise<void> {
    clearWindow();
    const transcript = buffer.trim();
    armed = false;
    buffer = "";

    if (!transcript) {
      events.onStateChange("listening");
      return;
    }

    events.onStateChange("executing");
    const result = deps.matchPhrase(transcript, deps.getCommands(), deps.getModes());
    events.onRecognized(toRecognizedEvent(transcript, result));

    if (result.status === "matched") {
      const kind = result.kind;
      const actionId = kind === "command" ? result.command.actionId : "mode.activate";
      const args: ActionArgs = kind === "command" ? result.command.args : { modeId: result.mode.id };
      const actionResult = await executeAction(actionId, args, { source: "voice", navigate: deps.navigate });
      events.onResult(actionResult);
      events.onStateChange(actionResult.ok ? "success" : "error");
      return;
    }

    const message =
      result.status === "ambiguous"
        ? `More than one command matches: ${result.candidates.join(", ")}`
        : "I didn't recognize that command";
    events.onResult({ ok: false, error: message });
    events.onStateChange("error");
  }

  return {
    handleTranscript(event: SpeechTranscriptEvent): void {
      if (!armed) {
        if (!containsWakeWord(event.transcript)) return;
        const seed = textAfterWakeWord(event.transcript);
        arm(seed);
        if (event.isFinal && seed) void finalize();
        return;
      }

      buffer = event.transcript;
      events.onStateChange("transcribing");
      if (event.isFinal) void finalize();
    },

    armManually(): void {
      if (armed) return;
      arm("");
    },

    finalizeNow(): void {
      if (!armed) return;
      void finalize();
    },

    reset(): void {
      disarm();
    },
  };
}
