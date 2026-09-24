// Exercises UseDictation's contract (./types.ts, frozen) against a fake
// SpeechProvider and a mocked ./microphone -- no live mic/engine involved
// (see SANT_VOICE_MODES_PLAN.md §5/§7). Also verifies the sessionLock
// rule: a dictation session can never start while a command session holds
// it, and vice versa.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createUseDictation } from "./dictation";
import { requestMicrophone } from "./microphone";
import { __resetSessionLockForTests, tryAcquireSession } from "./sessionLock";
import type { SpeechProvider, SpeechProviderCallbacks } from "./providers/types";

vi.mock("./microphone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./microphone")>();
  return { ...actual, requestMicrophone: vi.fn() };
});

const requestMicrophoneMock = vi.mocked(requestMicrophone);

function makeFakeProvider(overrides: Partial<SpeechProvider> = {}) {
  let callbacks: SpeechProviderCallbacks | null = null;
  const startSpy = vi.fn((cbs: SpeechProviderCallbacks) => {
    callbacks = cbs;
  });
  const stopSpy = vi.fn();
  const provider: SpeechProvider = {
    name: "fake",
    privacy: "remote",
    isSupported: () => true,
    start: startSpy,
    stop: stopSpy,
    ...overrides,
  };
  return { provider, startSpy, stopSpy, getCallbacks: () => callbacks };
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe("useDictation", () => {
  afterEach(() => {
    requestMicrophoneMock.mockReset();
    __resetSessionLockForTests();
  });

  it("starts idle and does nothing while inactive", () => {
    const { provider } = makeFakeProvider();
    const useDictation = createUseDictation(() => provider);

    const { result } = renderHook(() => useDictation({ onText: vi.fn(), active: false }));
    expect(result.current.status).toBe("idle");
  });

  it("goes to 'listening' and forwards final/interim text via onText when activated", async () => {
    requestMicrophoneMock.mockResolvedValue({ stream: {} as MediaStream, release: vi.fn() });
    const fake = makeFakeProvider();
    const useDictation = createUseDictation(() => fake.provider);
    const onText = vi.fn();

    const { result, rerender } = renderHook(({ active }) => useDictation({ onText, active }), { initialProps: { active: true } });
    await flush();

    expect(result.current.status).toBe("listening");
    expect(fake.startSpy).toHaveBeenCalledTimes(1);

    act(() => {
      fake.getCallbacks()?.onTranscript({ transcript: "hello wor", isFinal: false });
      fake.getCallbacks()?.onTranscript({ transcript: "hello world", isFinal: true });
    });

    expect(onText).toHaveBeenNthCalledWith(1, "hello wor", false);
    expect(onText).toHaveBeenNthCalledWith(2, "hello world", true);

    rerender({ active: false });
    expect(result.current.status).toBe("idle");
    expect(fake.stopSpy).toHaveBeenCalled();
  });

  it("reports 'unavailable' when the provider isn't supported", async () => {
    const fake = makeFakeProvider({ isSupported: () => false });
    const useDictation = createUseDictation(() => fake.provider);

    const { result } = renderHook(() => useDictation({ onText: vi.fn(), active: true }));
    await flush();

    expect(result.current.status).toBe("unavailable");
    expect(fake.startSpy).not.toHaveBeenCalled();
  });

  it("reports 'error' when microphone access fails", async () => {
    requestMicrophoneMock.mockRejectedValue(new Error("denied"));
    const fake = makeFakeProvider();
    const useDictation = createUseDictation(() => fake.provider);

    const { result } = renderHook(() => useDictation({ onText: vi.fn(), active: true }));
    await flush();

    expect(result.current.status).toBe("error");
  });

  it("refuses to start while a command session holds the lock", () => {
    expect(tryAcquireSession("command")).toBe(true);
    const fake = makeFakeProvider();
    const useDictation = createUseDictation(() => fake.provider);

    const { result } = renderHook(() => useDictation({ onText: vi.fn(), active: true }));

    expect(result.current.status).toBe("error");
    expect(fake.startSpy).not.toHaveBeenCalled();
  });

  it("stop() releases the mic and the session lock", async () => {
    const micHandle = { stream: {} as MediaStream, release: vi.fn() };
    requestMicrophoneMock.mockResolvedValue(micHandle);
    const fake = makeFakeProvider();
    const useDictation = createUseDictation(() => fake.provider);

    const { result } = renderHook(() => useDictation({ onText: vi.fn(), active: true }));
    await flush();

    act(() => result.current.stop());

    expect(micHandle.release).toHaveBeenCalled();
    expect(fake.stopSpy).toHaveBeenCalled();
    expect(tryAcquireSession("command")).toBe(true); // lock is free again
  });
});
