// Wake-word detection -- Prototype B (SANT_VOICE_MODES_PLAN.md §6): this
// looks for the wake word inside text a SpeechProvider has ALREADY sent to
// a transcription service (see providers/webSpeechProvider.ts's own
// header). It does not analyze raw audio and provides no on-device-only
// guarantee -- with the default provider, audio for the whole listening
// session (not just post-wake speech) leaves the device, wake word or not.
// A genuine local wake-word model (Prototype A) would run its own
// detector directly on unprocessed audio frames and would only ever hand
// audio to a remote provider (if any) *after* a local detection fired.
// Do not blur this distinction in code, comments, or the UI.

import { WAKE_WORD } from "../commands/types";

/** How long the armed command window stays open, waiting for a finalized command utterance, after "Sant" is heard. */
export const COMMAND_WINDOW_MS = 6000;

function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the wake word appears anywhere in the (normalized) transcript, as a whole word -- "sant" must not match inside "instant". */
export function containsWakeWord(transcript: string): boolean {
  const words = normalize(transcript).split(" ");
  return words.includes(WAKE_WORD);
}

/**
 * Whatever follows the FIRST wake-word occurrence, normalized -- used to
 * seed the command window with any trailing speech that arrived in the
 * same transcript chunk as "Sant" itself (e.g. "sant activate camera
 * control" heard as one chunk). Empty string if "Sant" was the whole
 * utterance, or if the wake word isn't present at all.
 */
export function textAfterWakeWord(transcript: string): string {
  const words = normalize(transcript).split(" ");
  const idx = words.indexOf(WAKE_WORD);
  if (idx === -1) return "";
  return words
    .slice(idx + 1)
    .join(" ")
    .trim();
}
