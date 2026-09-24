export type { SpeechProvider, SpeechProviderCallbacks, SpeechProviderFactory, SpeechProviderPrivacy, SpeechTranscriptEvent } from "./types";
export { createWebSpeechProvider } from "./webSpeechProvider";

import { createWebSpeechProvider } from "./webSpeechProvider";
import type { SpeechProviderFactory } from "./types";

/**
 * The only provider available this round (see SANT_VOICE_MODES_PLAN.md §5/§6
 * -- no local wake-word model is bundled in this repo). Swapping in a real
 * on-device engine later means adding a sibling factory and changing this
 * one line; nothing in wakeWord.ts/commandListening.ts/dictation.ts needs
 * to change, since they all depend on the SpeechProvider interface, not on
 * this factory.
 */
export const createDefaultSpeechProvider: SpeechProviderFactory = createWebSpeechProvider;
