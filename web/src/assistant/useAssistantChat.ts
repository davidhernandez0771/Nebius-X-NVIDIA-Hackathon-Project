// React state layer wiring messageStore (persistence) and providerAdapter
// (the Nebius-not-connected boundary) together for AssistantPage. Kept
// separate from the page component so both halves stay independently
// testable (see plan §4's test list: "provider-not-connected state").

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantConversation, AssistantMessage, AssistantState } from "./types";
import {
  addMessage,
  createConversation as createConversationInStore,
  deleteConversation as deleteConversationInStore,
  getDraft,
  loadAssistantState,
  makeId,
  saveAssistantState,
  setDraft as setDraftInStore,
  updateMessage,
} from "./messageStore";
import { NotConnectedProvider, ProviderError, type Provider } from "./providerAdapter";

export interface UseAssistantChatOptions {
  /** Injection point for tests / a future real provider. Defaults to NotConnectedProvider -- see plan §2/§5. */
  provider?: Provider;
}

export interface UseAssistantChat {
  conversations: AssistantConversation[];
  activeConversationId: string | null;
  messages: AssistantMessage[];
  draft: string;
  sending: boolean;
  providerConnected: boolean;
  providerId: string;
  selectConversation: (id: string) => void;
  newConversation: () => void;
  removeConversation: (id: string) => void;
  setDraft: (text: string) => void;
  send: () => Promise<void>;
  cancel: () => void;
}

const defaultProvider = new NotConnectedProvider();

export function useAssistantChat(options: UseAssistantChatOptions = {}): UseAssistantChat {
  const provider = options.provider ?? defaultProvider;
  const [state, setState] = useState<AssistantState>(() => loadAssistantState());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => state.conversations[0]?.id ?? null);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveAssistantState(state);
  }, [state]);

  // Lazily creates a conversation the first time it's needed (typing a
  // draft, or sending, before any conversation exists yet) rather than
  // forcing one to exist up front.
  const ensureConversation = useCallback((): { state: AssistantState; id: string } => {
    if (activeConversationId) return { state, id: activeConversationId };
    const created = createConversationInStore(state);
    setState(created.state);
    setActiveConversationId(created.conversation.id);
    return { state: created.state, id: created.conversation.id };
  }, [state, activeConversationId]);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const newConversation = useCallback(() => {
    setState((prev) => {
      const created = createConversationInStore(prev);
      setActiveConversationId(created.conversation.id);
      return created.state;
    });
  }, []);

  const removeConversation = useCallback((id: string) => {
    setState((prev) => deleteConversationInStore(prev, id));
    setActiveConversationId((prev) => (prev === id ? null : prev));
  }, []);

  const setDraftText = useCallback(
    (text: string) => {
      const { id } = ensureConversation();
      setState((prev) => setDraftInStore(prev, id, text));
    },
    [ensureConversation],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const { state: baseState, id: conversationId } = ensureConversation();
    const text = getDraft(baseState, conversationId).trim();
    if (!text || sending) return;

    const now = Date.now();
    const userMessage: AssistantMessage = {
      id: makeId("msg"),
      conversationId,
      role: "user",
      text,
      status: "sent",
      createdAt: now,
    };
    const assistantMessage: AssistantMessage = {
      id: makeId("msg"),
      conversationId,
      role: "assistant",
      text: "",
      status: "streaming",
      createdAt: now + 1,
    };

    setState((prev) => addMessage(addMessage(prev, userMessage), assistantMessage));
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let reply = "";
      for await (const chunk of provider.send([{ role: "user", text }], { signal: controller.signal })) {
        reply += chunk.textDelta;
        setState((prev) => updateMessage(prev, conversationId, assistantMessage.id, { text: reply }));
      }
      setState((prev) => updateMessage(prev, conversationId, assistantMessage.id, { status: "complete" }));
      // Only a genuinely successful reply clears the draft -- a
      // failed/disconnected send must keep it (plan §4).
      setState((prev) => setDraftInStore(prev, conversationId, ""));
    } catch (err) {
      const cancelled = err instanceof ProviderError && err.code === "cancelled";
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setState((prev) =>
        updateMessage(prev, conversationId, assistantMessage.id, {
          status: cancelled ? "cancelled" : "error",
          errorMessage: message,
        }),
      );
      // Draft intentionally left untouched here.
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [ensureConversation, provider, sending]);

  const messages = activeConversationId ? (state.messagesByConversation[activeConversationId] ?? []) : [];
  const draft = activeConversationId ? getDraft(state, activeConversationId) : "";

  return {
    conversations: state.conversations,
    activeConversationId,
    messages,
    draft,
    sending,
    providerConnected: provider.connected,
    providerId: provider.id,
    selectConversation,
    newConversation,
    removeConversation,
    setDraft: setDraftText,
    send,
    cancel,
  };
}
