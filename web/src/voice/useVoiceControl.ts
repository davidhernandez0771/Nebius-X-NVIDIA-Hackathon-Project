// Top-level command-mode hook: wires microphone.ts + a SpeechProvider +
// wakeWord.ts + commandListening.ts into the VoiceListeningState machine
// VoicePage.tsx renders. Dictation is a separate hook (./dictation.ts) --
// this file only ever drives the "off/listening/wake-detected/
// transcribing/executing/success/unavailable/error" states, never a
// dictation status.
//
// Integration note (see HANDOFF_WORKER1.md for the full explanation): this
// is the ONLY file in voice/ that imports `../commands/matcher` (Worker 2's
// file -- landed mid-session; see SANT_VOICE_MODES_PLAN.md §4, which
// anticipated this being a late dependency). Every other module in voice/
// takes MatchPhrase as an injected dependency instead, specifically so this
// integration seam stays isolated to one line in one file rather than
// spread across the module. `getCommands`/`getModes` are still
// caller-supplied functions (default `() => []`) rather than a direct
// `commands/store.ts` import here, so this hook stays testable without a
// real store -- VoicePage.tsx wires the real
// `getCommandsRepository().loadCommands()/loadModes()` in.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPhrase } from "../commands/matcher";
import type { MatchPhrase, Mode, SavedCommand } from "../commands/types";
import type { ActionResult } from "../actions/types";
import { createCommandListener } from "./commandListening";
import { MicError, type MicHandle, requestMicrophone } from "./microphone";
import { createDefaultSpeechProvider } from "./providers";
import type { SpeechProvider, SpeechProviderFactory, SpeechProviderPrivacy } from "./providers/types";
import { releaseSession, tryAcquireSession } from "./sessionLock";
import type { RecognizedCommandEvent, VoiceListeningState } from "./types";

/** How long a terminal success/error state stays on screen before automatically returning to "listening" (voice stays enabled the whole time -- this is a display nicety, not a lifecycle change). */
const RESULT_DISPLAY_MS = 3000;

export interface UseVoiceControlOptions {
  /** react-router's navigate(), passed straight through to ActionContext. */
  navigate: (to: string) => void;
  /** Defaults to `() => []` -- see this file's header. Pass the real saved-command list once it exists. */
  getCommands?: () => SavedCommand[];
  /** Defaults to `() => []` -- see this file's header. */
  getModes?: () => Mode[];
  /** Overridable for tests. Defaults to the real matcher. */
  matchPhraseFn?: MatchPhrase;
  /** Overridable for tests. Defaults to the real Web Speech provider. */
  createProvider?: SpeechProviderFactory;
  commandWindowMs?: number;
  resultDisplayMs?: number;
}

export interface VoiceProviderInfo {
  name: string;
  privacy: SpeechProviderPrivacy;
}

export interface VoiceControl {
  state: VoiceListeningState;
  enabled: boolean;
  /** Null until enable() has resolved which provider is in use; always present while enabled. Surfaced so the UI can render the honesty disclosure (SANT_VOICE_MODES_PLAN.md §6) next to real, current provider info instead of a hardcoded guess. */
  provider: VoiceProviderInfo | null;
  lastRecognized: RecognizedCommandEvent | null;
  lastResult: ActionResult | null;
  micError: string | null;
  enable: () => Promise<void>;
  disable: () => void;
  /** Push-to-talk: hold to arm the command window without saying "Sant", release to finalize. No-ops if voice isn't enabled. */
  startPushToTalk: () => void;
  endPushToTalk: () => void;
}

export function useVoiceControl(options: UseVoiceControlOptions): VoiceControl {
  const {
    navigate,
    getCommands = () => [],
    getModes = () => [],
    matchPhraseFn = matchPhrase,
    createProvider = createDefaultSpeechProvider,
    commandWindowMs,
    resultDisplayMs = RESULT_DISPLAY_MS,
  } = options;

  const [state, setState] = useState<VoiceListeningState>("idle");
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<VoiceProviderInfo | null>(null);
  const [lastRecognized, setLastRecognized] = useState<RecognizedCommandEvent | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const providerRef = useRef<SpeechProvider | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const intentionallyStoppedRef = useRef(true);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevertTimer = useCallback(() => {
    if (revertTimerRef.current !== null) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
  }, []);

  const handleStateChange = useCallback(
    (next: VoiceListeningState) => {
      setState(next);
      clearRevertTimer();
      if (next === "success" || next === "error") {
        revertTimerRef.current = setTimeout(() => {
          revertTimerRef.current = null;
          // Only revert if voice is still on -- disable() already forces "idle".
          setState((s) => (s === "success" || s === "error" ? "listening" : s));
        }, resultDisplayMs);
      }
    },
    [clearRevertTimer, resultDisplayMs],
  );

  const listener = useMemo(
    () =>
      createCommandListener(
        { matchPhrase: matchPhraseFn, getCommands, getModes, navigate, commandWindowMs },
        { onStateChange: handleStateChange, onRecognized: setLastRecognized, onResult: setLastResult },
      ),
    [matchPhraseFn, getCommands, getModes, navigate, commandWindowMs, handleStateChange],
  );

  const disable = useCallback(() => {
    intentionallyStoppedRef.current = true;
    clearRevertTimer();
    providerRef.current?.stop();
    providerRef.current = null;
    micRef.current?.release();
    micRef.current = null;
    listener.reset();
    releaseSession("command");
    setEnabled(false);
    setProvider(null);
    setState("idle");
  }, [clearRevertTimer, listener]);

  // Starts (or restarts, on the provider's own onEnd) one recognition
  // session against whatever provider instance is currently held in
  // providerRef. Reads everything through refs so its identity never needs
  // to change across renders.
  const startProviderSession = useCallback(() => {
    const activeProvider = providerRef.current;
    if (!activeProvider) return;
    activeProvider.start({
      onTranscript: (event) => listener.handleTranscript(event),
      onError: (message) => {
        setMicError(message);
        handleStateChange("error");
      },
      onEnd: () => {
        if (!intentionallyStoppedRef.current && providerRef.current === activeProvider) {
          // Some engines end a "continuous" session after a period of
          // silence -- restart transparently so "enabled" doesn't silently
          // go deaf. If this becomes a tight error loop in practice (e.g.
          // permission revoked mid-session), onError above already routes
          // to "error" and a real revocation will make the next start()
          // fail via requestMicrophone/isSupported on the *next* enable(),
          // not loop here.
          startProviderSession();
        }
      },
    });
  }, [listener, handleStateChange]);

  const enable = useCallback(async () => {
    if (providerRef.current) return; // already enabled
    if (!tryAcquireSession("command")) {
      setMicError("Dictation is currently active. Stop dictating before enabling voice commands.");
      setState("error");
      return;
    }

    setMicError(null);
    intentionallyStoppedRef.current = false;

    let mic: MicHandle;
    try {
      mic = await requestMicrophone({
        onInterrupted: () => {
          setMicError("Microphone was disconnected");
          disable();
        },
      });
    } catch (err) {
      releaseSession("command");
      intentionallyStoppedRef.current = true;
      setMicError(err instanceof Error ? err.message : "Microphone access failed");
      setState(err instanceof MicError && err.kind === "unsupported" ? "unavailable" : "error");
      return;
    }

    const nextProvider = createProvider();
    if (!nextProvider.isSupported()) {
      mic.release();
      releaseSession("command");
      intentionallyStoppedRef.current = true;
      setMicError("Speech recognition isn't supported in this browser");
      setState("unavailable");
      return;
    }

    micRef.current = mic;
    providerRef.current = nextProvider;
    setProvider({ name: nextProvider.name, privacy: nextProvider.privacy });
    setEnabled(true);
    setState("listening");
    startProviderSession();
  }, [createProvider, disable, startProviderSession]);

  const startPushToTalk = useCallback(() => {
    if (!providerRef.current) return;
    listener.armManually();
  }, [listener]);

  const endPushToTalk = useCallback(() => {
    if (!providerRef.current) return;
    listener.finalizeNow();
  }, [listener]);

  // Release the mic/provider on unmount even if the caller never explicitly
  // disabled -- same discipline as the hand-control feature (see
  // useHandPointer.ts's own unmount effect).
  useEffect(() => {
    return () => {
      intentionallyStoppedRef.current = true;
      clearRevertTimer();
      providerRef.current?.stop();
      micRef.current?.release();
      releaseSession("command");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, enabled, provider, lastRecognized, lastResult, micError, enable, disable, startPushToTalk, endPushToTalk };
}
