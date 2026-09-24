// The replaceable speech-provider boundary. Everything above this interface
// (wake word, command listening, dictation) is written against
// SpeechProvider only, never against a specific engine -- so a genuine
// on-device wake-word model (e.g. Porcupine or similar) can be dropped in
// as a second implementation later without touching the rest of voice/.
// See SANT_VOICE_MODES_PLAN.md §4/§6.

/**
 * "local": genuinely on-device -- no audio leaves the machine.
 * "remote": streams audio to a third-party server for transcription.
 * Surfaced honestly in the UI (SANT_VOICE_MODES_PLAN.md §6) -- a provider
 * must never claim "local" unless that's literally true, and the wake-word
 * layer built on top of a "remote" provider must not be described as a
 * private/offline wake-word model.
 */
export type SpeechProviderPrivacy = "local" | "remote";

export interface SpeechTranscriptEvent {
  transcript: string;
  isFinal: boolean;
}

export interface SpeechProviderCallbacks {
  onTranscript: (event: SpeechTranscriptEvent) => void;
  /** A recoverable-or-not error from the provider; the caller decides what to do (surface + stop, or let onEnd's auto-restart handle it). */
  onError: (message: string) => void;
  /** The recognition session ended, whether by our stop() or by the engine itself (e.g. a silence timeout). Never fired as a *result* of a thrown error being caught -- onError covers that case. */
  onEnd: () => void;
}

export interface SpeechProvider {
  readonly name: string;
  readonly privacy: SpeechProviderPrivacy;
  /** Re-checked live, not cached -- support can depend on the current browser/context. */
  isSupported: () => boolean;
  /** No-op if already started. */
  start: (callbacks: SpeechProviderCallbacks) => void;
  /** No-op if not started. Idempotent. */
  stop: () => void;
}

export type SpeechProviderFactory = () => SpeechProvider;
