// Assistant chat types (Worker 3). Not shared with any other module this
// round -- see SANT_VOICE_MODES_PLAN.md §4 "Worker 3 -- Assistant chat
// interface". This is a distinct, new, general-purpose chat surface, not
// the existing inventory-command chat at ../pages/Chat.tsx (which has its
// own types and stays untouched).

export type MessageRole = "user" | "assistant";

export type MessageStatus =
  | "sent" // the user's own message, recorded as-is
  | "streaming" // an assistant reply currently arriving from the provider
  | "complete" // an assistant reply finished normally
  | "error" // the provider could not answer (e.g. not connected) -- see errorMessage
  | "cancelled"; // the user cancelled an in-flight reply

export interface AssistantMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  createdAt: number; // epoch ms
  /** Set only when status is "error" -- always shown to the user, never swallowed. */
  errorMessage?: string;
}

export interface AssistantConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** The full shape persisted to localStorage by messageStore.ts. */
export interface AssistantState {
  conversations: AssistantConversation[];
  messagesByConversation: Record<string, AssistantMessage[]>;
  /** Unsent composer text per conversation. Survives reloads and a failed/disconnected send -- see plan §4. */
  draftsByConversation: Record<string, string>;
}
