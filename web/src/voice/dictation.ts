// Implements UseDictation exactly as typed in ./types.ts (frozen; function
// shape is the spec, internals are ours). Dictation is a separate speech
// session from command-listening -- see sessionLock.ts -- spoken command
// phrases while dictating insert as text, they never execute, because this
// module never calls matchPhrase()/executeAction() at all.
//
// Same honesty note as wakeWord.ts/webSpeechProvider.ts applies here: with
// the current default provider, dictated audio is sent to a remote
// transcription service, not processed on-device.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DictationController, DictationStatus, UseDictation, UseDictationOptions } from "./types";
import { type MicHandle, requestMicrophone } from "./microphone";
import { createDefaultSpeechProvider } from "./providers";
import type { SpeechProvider, SpeechProviderFactory } from "./providers/types";
import { releaseSession, tryAcquireSession } from "./sessionLock";

/** Test/internal hook: lets tests (and, in principle, a future local-engine swap) inject a provider factory without changing the public UseDictation signature, which is frozen. */
export function createUseDictation(createProvider: SpeechProviderFactory = createDefaultSpeechProvider): UseDictation {
  return function useDictationImpl({ onText, active }: UseDictationOptions): DictationController {
    const [status, setStatus] = useState<DictationStatus>("idle");

    const providerRef = useRef<SpeechProvider | null>(null);
    const micRef = useRef<MicHandle | null>(null);
    const onTextRef = useRef(onText);
    onTextRef.current = onText;

    // Invalidates a still-pending requestMicrophone()/provider.start() from
    // a start() call that a subsequent stop() (or unmount) has already
    // superseded -- start()/stop() must stay `() => void` per the frozen
    // DictationController type, so this can't be a cleanup closure returned
    // from start() the way a normal effect would do it.
    const startTokenRef = useRef(0);

    const teardown = useCallback((nextStatus: DictationStatus) => {
      providerRef.current?.stop();
      providerRef.current = null;
      micRef.current?.release();
      micRef.current = null;
      releaseSession("dictation");
      setStatus(nextStatus);
    }, []);

    const stop = useCallback(() => {
      startTokenRef.current++;
      if (!providerRef.current && !micRef.current) {
        // Nothing running yet (e.g. stop() called while requestMicrophone()
        // is still pending) -- still release the lock and reflect idle.
        releaseSession("dictation");
        setStatus("idle");
        return;
      }
      teardown("idle");
    }, [teardown]);

    const start = useCallback(() => {
      if (providerRef.current) return; // already running
      if (!tryAcquireSession("dictation")) {
        setStatus("error");
        return;
      }

      const provider = createProvider();
      if (!provider.isSupported()) {
        releaseSession("dictation");
        setStatus("unavailable");
        return;
      }

      const token = ++startTokenRef.current;
      setStatus("listening");

      requestMicrophone({
        onInterrupted: () => teardown("error"),
      })
        .then((mic) => {
          if (startTokenRef.current !== token) {
            // Superseded by a stop() (or another start()) while this was pending.
            mic.release();
            releaseSession("dictation");
            return;
          }
          micRef.current = mic;
          providerRef.current = provider;
          provider.start({
            onTranscript: (event) => onTextRef.current(event.transcript, event.isFinal),
            onError: () => teardown("error"),
            onEnd: () => {
              // The engine ended on its own (e.g. a silence timeout). Treat
              // it the same as an explicit stop -- the composer can press
              // the mic button again rather than us silently restarting a
              // session the user may not still want.
              providerRef.current = null;
              micRef.current?.release();
              micRef.current = null;
              releaseSession("dictation");
              setStatus((s) => (s === "error" ? s : "idle"));
            },
          });
        })
        .catch(() => {
          if (startTokenRef.current === token) {
            releaseSession("dictation");
            setStatus("error");
          }
        });
    }, [teardown]);

    useEffect(() => {
      if (active) start();
      else stop();
    }, [active, start, stop]);

    // Unmount safety net, mirroring the hand-control feature's own
    // release-on-unmount discipline (see useHandPointer.ts).
    useEffect(() => {
      return () => {
        startTokenRef.current++;
        providerRef.current?.stop();
        micRef.current?.release();
        releaseSession("dictation");
      };
    }, []);

    return { status, start, stop };
  };
}

export const useDictation: UseDictation = createUseDictation();
