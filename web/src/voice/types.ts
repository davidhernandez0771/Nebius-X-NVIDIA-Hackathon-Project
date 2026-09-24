// Shared contract for voice input (coordinator-owned, frozen for this
// round). Worker 1 implements every module in voice/ against this; Worker
// 3's assistant composer imports only UseDictation/DictationController
// (read-only) for its mic button, never edits this file. See
// SANT_VOICE_MODES_PLAN.md.

export type VoiceListeningState =
  | "idle" // mic off
  | "listening" // mic on, waiting for the wake word (command mode)
  | "wake-detected" // "Sant" heard, a short command window is armed
  | "transcribing" // capturing the command/utterance inside that window
  | "executing" // a matched command is running via the action registry
  | "success"
  | "unavailable" // no browser support, or permission not yet resolved
  | "error";

export type VoiceMode = "off" | "command" | "dictation";

export interface RecognizedCommandEvent {
  transcript: string;
  matchedActionId: string | null; // null if unknown or ambiguous
  matchedLabel: string | null; // display name of the matched command/mode, for the UI
}

export type DictationStatus = "idle" | "listening" | "unavailable" | "error";

export interface DictationController {
  status: DictationStatus;
  start: () => void;
  stop: () => void;
}

export interface UseDictationOptions {
  /** Fired on every transcript update. isFinal distinguishes a finalized chunk from an in-progress interim one -- the composer must append text only when isFinal is true, so interim updates never cause duplicate insertion. */
  onText: (text: string, isFinal: boolean) => void;
  /** True while the composer wants dictation active; false stops and releases the mic. Same opt-in convention as the hand-control feature (see HAND_INTERACTION_PLAN.md): no mic activity happens until this is true. */
  active: boolean;
}

/** Implemented by Worker 1 in voice/dictation.ts. A React hook -- dictation and command-listening are two separate speech sessions (see the plan) and must never run at the same time. */
export type UseDictation = (options: UseDictationOptions) => DictationController;
