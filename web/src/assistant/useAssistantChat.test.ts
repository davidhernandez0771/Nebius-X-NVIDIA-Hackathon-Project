import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAssistantChat } from "./useAssistantChat";
import { NotConnectedProvider } from "./providerAdapter";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("useAssistantChat with the real NotConnectedProvider", () => {
  it("recording a send ends with an error-status assistant message, and never fabricates reply text", async () => {
    const { result } = renderHook(() => useAssistantChat({ provider: new NotConnectedProvider() }));

    act(() => {
      result.current.setDraft("are you there?");
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    const [userMessage, assistantMessage] = result.current.messages;
    expect(userMessage.role).toBe("user");
    expect(userMessage.status).toBe("sent");
    expect(userMessage.text).toBe("are you there?");

    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.status).toBe("error");
    expect(assistantMessage.text).toBe(""); // never a fabricated reply body
    expect(assistantMessage.errorMessage).toMatch(/not connected/i);
  });

  it("never silently discards the draft on a failed/disconnected send -- it stays in the composer", async () => {
    const { result } = renderHook(() => useAssistantChat({ provider: new NotConnectedProvider() }));

    act(() => {
      result.current.setDraft("please don't lose this");
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(result.current.sending).toBe(false);
    });

    expect(result.current.draft).toBe("please don't lose this");
  });

  it("exposes providerConnected/providerId honestly for the not-connected provider", () => {
    const { result } = renderHook(() => useAssistantChat({ provider: new NotConnectedProvider() }));
    expect(result.current.providerConnected).toBe(false);
    expect(result.current.providerId).toBe("not-connected");
  });

  it("ignores send() when the draft is empty", async () => {
    const { result } = renderHook(() => useAssistantChat({ provider: new NotConnectedProvider() }));
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.messages).toHaveLength(0);
  });
});
