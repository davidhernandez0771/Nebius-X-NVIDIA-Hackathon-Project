// Provider boundary for the assistant chat (Worker 3). See
// SANT_VOICE_MODES_PLAN.md §2/§5: Nebius is genuinely NOT connected for
// this new surface this round. NotConnectedProvider is the only
// implementation -- it never fabricates a reply, a typing indicator that
// "completes," or anything resembling a real answer. Real Nebius wiring is
// a deliberate future integration, not something to half-build here.

export interface ProviderMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ProviderChunk {
  /** Incremental text for a streaming reply. */
  textDelta: string;
  done: boolean;
}

export type ProviderErrorCode = "not_connected" | "cancelled" | "unknown";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export interface Provider {
  /** Stable id, shown in the UI (e.g. a StatusPill) -- never a marketing name. */
  readonly id: string;
  readonly connected: boolean;
  /**
   * Streams a reply as an async iterable of chunks. A provider that cannot
   * actually answer must throw a ProviderError -- never yield a fabricated
   * chunk. `signal` cancels an in-flight call; implementations must stop
   * producing chunks as soon as it aborts.
   */
  send(messages: ProviderMessage[], options: { signal: AbortSignal }): AsyncIterable<ProviderChunk>;
}

const NOT_CONNECTED_MESSAGE =
  "Nebius is not connected for the assistant chat yet. This is a new surface separate from the existing inventory chat, and it has no live model behind it in this build.";

/**
 * The only Provider implementation this round. Deliberately does no work:
 * no fetch, no fixture reply dressed up as real, no delay meant to look
 * like "thinking." It throws a typed, honest error the instant it's asked
 * to answer, so the UI can show a clear disconnected state instead of
 * quietly failing or inventing a response.
 */
export class NotConnectedProvider implements Provider {
  readonly id = "not-connected";
  readonly connected = false;

  // eslint-disable-next-line require-yield -- intentionally never yields; see class doc.
  async *send(_messages: ProviderMessage[], options: { signal: AbortSignal }): AsyncIterable<ProviderChunk> {
    if (options.signal.aborted) {
      throw new ProviderError("cancelled", "Cancelled before sending.");
    }
    throw new ProviderError("not_connected", NOT_CONNECTED_MESSAGE);
  }
}

/**
 * Dev-preview fixture provider -- NOT used by AssistantPage by default and
 * NOT a substitute for a real connection. Exists only so the message-list
 * UI states (streaming/complete) can be sanity-checked visually without a
 * live backend. Every reply is prefixed so it can never be mistaken for a
 * real answer, and this class is never registered as the app's default
 * provider.
 */
export class FixtureProvider implements Provider {
  readonly id = "fixture-preview";
  readonly connected = true;

  async *send(messages: ProviderMessage[], options: { signal: AbortSignal }): AsyncIterable<ProviderChunk> {
    const last = messages[messages.length - 1]?.text ?? "";
    const reply = `[DEV FIXTURE -- not a real reply, Nebius not connected] You said: "${last}"`;
    for (const word of reply.split(" ")) {
      if (options.signal.aborted) throw new ProviderError("cancelled", "Cancelled.");
      yield { textDelta: (word + " "), done: false };
    }
    yield { textDelta: "", done: true };
  }
}
