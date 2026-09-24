// Versioned localStorage persistence for assistant conversations, messages
// and drafts (Worker 3). Mirrors the convention in
// ../hand/integration/useHandPointer.ts's loadControlRegion/saveControlRegion
// (see plan §1/§4): every read is wrapped in try/catch, and malformed or
// unversioned data recovers to an empty state rather than throwing or
// crashing the page. Pure functions only, so the React state layer
// (useAssistantChat.ts) and tests can both operate on plain values.

import type { AssistantConversation, AssistantMessage, AssistantState, MessageRole, MessageStatus } from "./types";

const STORAGE_KEY = "sant.assistant.state";
const STORAGE_VERSION = 1;

interface PersistedState extends AssistantState {
  version: number;
}

const ROLES: readonly MessageRole[] = ["user", "assistant"];
const STATUSES: readonly MessageStatus[] = ["sent", "streaming", "complete", "error", "cancelled"];

export function emptyAssistantState(): AssistantState {
  return { conversations: [], messagesByConversation: {}, draftsByConversation: {} };
}

function isConversation(v: unknown): v is AssistantConversation {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.title === "string" && typeof c.createdAt === "number" && typeof c.updatedAt === "number";
}

function isMessage(v: unknown): v is AssistantMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.conversationId === "string" &&
    ROLES.includes(m.role as MessageRole) &&
    typeof m.text === "string" &&
    STATUSES.includes(m.status as MessageStatus) &&
    typeof m.createdAt === "number" &&
    (m.errorMessage === undefined || typeof m.errorMessage === "string")
  );
}

/** Never throws. Anything that doesn't match the expected shape is dropped, not crashed on. */
function sanitize(raw: unknown): AssistantState {
  if (!raw || typeof raw !== "object") return emptyAssistantState();
  const parsed = raw as Record<string, unknown>;
  if (parsed.version !== STORAGE_VERSION) return emptyAssistantState();

  const conversations = Array.isArray(parsed.conversations) ? parsed.conversations.filter(isConversation) : [];

  const messagesByConversation: Record<string, AssistantMessage[]> = {};
  if (parsed.messagesByConversation && typeof parsed.messagesByConversation === "object") {
    for (const [convId, list] of Object.entries(parsed.messagesByConversation as Record<string, unknown>)) {
      if (Array.isArray(list)) messagesByConversation[convId] = list.filter(isMessage);
    }
  }

  const draftsByConversation: Record<string, string> = {};
  if (parsed.draftsByConversation && typeof parsed.draftsByConversation === "object") {
    for (const [convId, text] of Object.entries(parsed.draftsByConversation as Record<string, unknown>)) {
      if (typeof text === "string") draftsByConversation[convId] = text;
    }
  }

  return { conversations, messagesByConversation, draftsByConversation };
}

export function loadAssistantState(): AssistantState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAssistantState();
    return sanitize(JSON.parse(raw));
  } catch {
    return emptyAssistantState();
  }
}

export function saveAssistantState(state: AssistantState): void {
  try {
    const persisted: PersistedState = { version: STORAGE_VERSION, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Private browsing / storage disabled / quota -- history just won't
    // persist across sessions. Not fatal, nothing else depends on this.
  }
}

// ---------------------------------------------------------------- helpers

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function createConversation(state: AssistantState, title = "New conversation"): { state: AssistantState; conversation: AssistantConversation } {
  const now = Date.now();
  const conversation: AssistantConversation = { id: makeId("conv"), title, createdAt: now, updatedAt: now };
  return {
    conversation,
    state: {
      conversations: [conversation, ...state.conversations],
      messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
      draftsByConversation: state.draftsByConversation,
    },
  };
}

export function deleteConversation(state: AssistantState, conversationId: string): AssistantState {
  const messagesByConversation = { ...state.messagesByConversation };
  delete messagesByConversation[conversationId];
  const draftsByConversation = { ...state.draftsByConversation };
  delete draftsByConversation[conversationId];
  return {
    conversations: state.conversations.filter((c) => c.id !== conversationId),
    messagesByConversation,
    draftsByConversation,
  };
}

export function addMessage(state: AssistantState, message: AssistantMessage): AssistantState {
  const existing = state.messagesByConversation[message.conversationId] ?? [];
  return {
    conversations: state.conversations.map((c) => (c.id === message.conversationId ? { ...c, updatedAt: message.createdAt } : c)),
    messagesByConversation: { ...state.messagesByConversation, [message.conversationId]: [...existing, message] },
    draftsByConversation: state.draftsByConversation,
  };
}

export function updateMessage(
  state: AssistantState,
  conversationId: string,
  messageId: string,
  patch: Partial<Pick<AssistantMessage, "text" | "status" | "errorMessage">>,
): AssistantState {
  const existing = state.messagesByConversation[conversationId];
  if (!existing) return state;
  return {
    ...state,
    messagesByConversation: {
      ...state.messagesByConversation,
      [conversationId]: existing.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    },
  };
}

export function setDraft(state: AssistantState, conversationId: string, text: string): AssistantState {
  const draftsByConversation = { ...state.draftsByConversation };
  if (text) draftsByConversation[conversationId] = text;
  else delete draftsByConversation[conversationId];
  return { ...state, draftsByConversation };
}

export function getDraft(state: AssistantState, conversationId: string): string {
  return state.draftsByConversation[conversationId] ?? "";
}
