// Prototype B, explicitly (see SANT_VOICE_MODES_PLAN.md §6): wraps the
// non-standard Web Speech API (`SpeechRecognition` /
// `webkitSpeechRecognition`). In Chrome/Edge this continuously streams raw
// audio to a remote server (Google's, for Chrome) for transcription -- it
// is NOT a local/offline/private wake-word engine, and this file must
// never be described as one. `privacy: "remote"` below is load-bearing:
// every caller (wakeWord.ts's honesty comment, VoicePage's UI copy) reads
// it rather than re-asserting "remote" independently, so the claim can't
// drift out of sync in only one place.
//
// This is also the ONLY file in voice/ that talks to a concrete speech
// engine -- everything else in this module is written against
// `SpeechProvider` (./types.ts), so a real local wake-word model can be
// added later as a sibling file + factory swap, without touching wakeWord,
// commandListening, dictation, or the UI.

import type { SpeechProvider, SpeechProviderCallbacks } from "./types";

// The full SpeechRecognition object shape is NOT part of TypeScript's DOM
// lib (only its SpeechRecognitionResult/-Alternative/-ResultList sub-types
// are, as of the bundled lib.dom.d.ts) and the constructor itself only
// exists, Chromium-prefixed, at runtime -- never as an ambient global.
// Declared locally, deliberately, instead of augmenting `Window` globally,
// so this non-standard assumption stays contained to this one file.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function createWebSpeechProvider(): SpeechProvider {
  let recognition: SpeechRecognitionLike | null = null;

  const detach = () => {
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition = null;
  };

  return {
    name: "Web Speech API (remote, browser built-in)",
    privacy: "remote",

    isSupported: () => getSpeechRecognitionCtor() !== null,

    start: (callbacks: SpeechProviderCallbacks) => {
      if (recognition) return; // already running
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        callbacks.onError("Speech recognition isn't supported in this browser");
        return;
      }

      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";

      r.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results.item(i);
          const alternative = result.item(0);
          if (!alternative) continue;
          callbacks.onTranscript({ transcript: alternative.transcript, isFinal: result.isFinal });
        }
      };
      r.onerror = (event) => {
        callbacks.onError(event.error ? `Speech recognition error: ${event.error}` : "Speech recognition error");
      };
      r.onend = () => {
        detach();
        callbacks.onEnd();
      };

      recognition = r;
      try {
        r.start();
      } catch (err) {
        detach();
        callbacks.onError(err instanceof Error ? err.message : "Failed to start speech recognition");
      }
    },

    stop: () => {
      recognition?.stop();
      detach();
    },
  };
}
