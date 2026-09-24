// jsdom doesn't implement the (non-standard) Web Speech API at all, so
// these tests install a fake `window.SpeechRecognition` constructor and
// drive it directly -- there is no live speech engine or microphone
// involved (see SANT_VOICE_MODES_PLAN.md §5/§7).

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSpeechProvider } from "./webSpeechProvider";

type ResultLike = { isFinal: boolean; alternatives: string[] };

function makeResultList(results: ResultLike[]) {
  const list = results.map((r) => ({
    isFinal: r.isFinal,
    item: (i: number) => ({ transcript: r.alternatives[i], confidence: 1 }),
    length: r.alternatives.length,
  }));
  return {
    length: list.length,
    item: (i: number) => list[i],
  };
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => {
    this.started = true;
  });
  stop = vi.fn(() => {
    this.started = false;
    this.onend?.();
  });
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

describe("createWebSpeechProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeRecognition.instances = [];
  });

  it("reports privacy: 'remote' -- this is Prototype B, never claim local/offline", () => {
    const provider = createWebSpeechProvider();
    expect(provider.privacy).toBe("remote");
  });

  it("isSupported() is false when neither global constructor exists", () => {
    vi.stubGlobal("window", {});
    const provider = createWebSpeechProvider();
    expect(provider.isSupported()).toBe(false);
  });

  it("isSupported() is true when webkitSpeechRecognition exists", () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    const provider = createWebSpeechProvider();
    expect(provider.isSupported()).toBe(true);
  });

  it("start() reports unsupported via onError instead of throwing, when unsupported", () => {
    vi.stubGlobal("window", {});
    const provider = createWebSpeechProvider();
    const onError = vi.fn();
    provider.start({ onTranscript: vi.fn(), onError, onEnd: vi.fn() });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("supported"));
  });

  it("configures continuous + interim results and forwards final/interim transcripts", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const provider = createWebSpeechProvider();
    const onTranscript = vi.fn();
    provider.start({ onTranscript, onError: vi.fn(), onEnd: vi.fn() });

    const instance = FakeRecognition.instances[0];
    expect(instance.continuous).toBe(true);
    expect(instance.interimResults).toBe(true);
    expect(instance.start).toHaveBeenCalled();

    instance.onresult?.({
      resultIndex: 0,
      results: makeResultList([
        { isFinal: false, alternatives: ["hello sa"] },
        { isFinal: true, alternatives: ["hello sant"] },
      ]),
    });

    expect(onTranscript).toHaveBeenNthCalledWith(1, { transcript: "hello sa", isFinal: false });
    expect(onTranscript).toHaveBeenNthCalledWith(2, { transcript: "hello sant", isFinal: true });
  });

  it("forwards engine errors through onError", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const provider = createWebSpeechProvider();
    const onError = vi.fn();
    provider.start({ onTranscript: vi.fn(), onError, onEnd: vi.fn() });

    FakeRecognition.instances[0].onerror?.({ error: "network" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("network"));
  });

  it("calls onEnd when the engine ends on its own, and start() is a no-op while already running", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const provider = createWebSpeechProvider();
    const onEnd = vi.fn();
    provider.start({ onTranscript: vi.fn(), onError: vi.fn(), onEnd });

    provider.start({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() }); // no-op: already running
    expect(FakeRecognition.instances).toHaveLength(1);

    FakeRecognition.instances[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stop() calls the engine's stop() and is a no-op if never started", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const provider = createWebSpeechProvider();
    expect(() => provider.stop()).not.toThrow();

    provider.start({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    provider.stop();
    expect(FakeRecognition.instances[0].stop).toHaveBeenCalled();
  });
});
