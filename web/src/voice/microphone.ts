// One coordinated microphone lifecycle: permission request/denial,
// device-missing, mid-session interruption, and guaranteed cleanup. This
// module owns its own `getUserMedia` stream independently of whatever a
// SpeechProvider does internally (e.g. the Web Speech API manages its own
// hidden capture) -- that keeps "disable fully releases the mic" a
// verifiable fact about tracks *we* hold and stop, not an assumption about
// a third-party API's internals. See SANT_VOICE_MODES_PLAN.md §4/§8.

export type MicErrorKind = "unsupported" | "permission-denied" | "device-not-found" | "unknown";

export class MicError extends Error {
  readonly kind: MicErrorKind;
  constructor(kind: MicErrorKind, message: string) {
    super(message);
    this.name = "MicError";
    this.kind = kind;
  }
}

export interface MicHandle {
  readonly stream: MediaStream;
  /** Stops every track. Idempotent -- safe to call more than once. */
  release: () => void;
}

export interface RequestMicrophoneOptions {
  /** Fired if a track we hold ends on its own (device unplugged, OS revokes permission mid-session) -- distinct from our own release() call, which never fires this. */
  onInterrupted?: () => void;
}

function toMicError(err: unknown): MicError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return new MicError("permission-denied", "Microphone permission was denied");
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return new MicError("device-not-found", "No microphone was found");
  }
  return new MicError("unknown", err instanceof Error ? err.message : "Failed to access the microphone");
}

/** Throws MicError (never a raw DOMException) so callers can branch on `.kind` without knowing browser-specific error names. */
export async function requestMicrophone(options: RequestMicrophoneOptions = {}): Promise<MicHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError("unsupported", "Microphone access isn't supported in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw toMicError(err);
  }

  let released = false;
  const tracks = stream.getTracks();
  const onEnded = () => {
    if (!released) options.onInterrupted?.();
  };
  for (const track of tracks) track.addEventListener("ended", onEnded);

  return {
    stream,
    release: () => {
      if (released) return;
      released = true;
      for (const track of tracks) {
        track.removeEventListener("ended", onEnded);
        track.stop();
      }
    },
  };
}

export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

/** Best-effort permission read via the Permissions API, without triggering a prompt. Falls back to "unknown" wherever the API is missing or the browser rejects the query (e.g. Safari) -- never throws. */
export async function queryMicPermissionState(): Promise<MicPermissionState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state as MicPermissionState;
  } catch {
    return "unknown";
  }
}
