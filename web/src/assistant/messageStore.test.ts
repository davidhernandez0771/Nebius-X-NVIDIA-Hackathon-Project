import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createConversation,
  deleteConversation,
  emptyAssistantState,
  getDraft,
  loadAssistantState,
  saveAssistantState,
  setDraft,
  updateMessage,
} from "./messageStore";
import type { AssistantMessage, AssistantState } from "./types";

const STORAGE_KEY = "sant.assistant.state";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("loadAssistantState -- malformed data recovery", () => {
  it("returns an empty state when nothing is stored", () => {
    expect(loadAssistantState()).toEqual(emptyAssistantState());
  });

  it("recovers to empty on unparsable JSON instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadAssistantState()).not.toThrow();
    expect(loadAssistantState()).toEqual(emptyAssistantState());
  });

  it("recovers to empty when the version tag doesn't match", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, conversations: [] }));
    expect(loadAssistantState()).toEqual(emptyAssistantState());
  });

  it("drops malformed conversation entries but keeps well-formed ones", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversations: [
          { id: "c1", title: "Good", createdAt: 1, updatedAt: 1 },
          { id: "c2" /* missing fields */ },
          "not even an object",
          null,
        ],
        messagesByConversation: {},
        draftsByConversation: {},
      }),
    );
    const state = loadAssistantState();
    expect(state.conversations).toEqual([{ id: "c1", title: "Good", createdAt: 1, updatedAt: 1 }]);
  });

  it("drops malformed messages but keeps well-formed ones, and ignores non-object payloads entirely", () => {
    const goodMessage: AssistantMessage = {
      id: "m1",
      conversationId: "c1",
      role: "user",
      text: "hi",
      status: "sent",
      createdAt: 1,
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversations: [],
        messagesByConversation: {
          c1: [goodMessage, { id: "bad" }, { ...goodMessage, role: "villain" }, 42],
        },
        draftsByConversation: {},
      }),
    );
    expect(loadAssistantState().messagesByConversation.c1).toEqual([goodMessage]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));
    expect(loadAssistantState()).toEqual(emptyAssistantState());

    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadAssistantState()).toEqual(emptyAssistantState());
  });

  it("never throws even if localStorage.getItem itself throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("disabled storage");
    };
    try {
      expect(() => loadAssistantState()).not.toThrow();
      expect(loadAssistantState()).toEqual(emptyAssistantState());
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("saveAssistantState", () => {
  it("round-trips a well-formed state through localStorage", () => {
    const created = createConversation(emptyAssistantState(), "Hello");
    saveAssistantState(created.state);
    const reloaded = loadAssistantState();
    expect(reloaded.conversations).toEqual(created.state.conversations);
  });

  it("never throws even if localStorage.setItem itself throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => saveAssistantState(emptyAssistantState())).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("drafts", () => {
  it("persists and retrieves a draft per conversation", () => {
    let state: AssistantState = emptyAssistantState();
    state = setDraft(state, "c1", "unsent text");
    expect(getDraft(state, "c1")).toBe("unsent text");
    expect(getDraft(state, "c2")).toBe("");
  });

  it("clears a draft by setting it to an empty string", () => {
    let state: AssistantState = emptyAssistantState();
    state = setDraft(state, "c1", "something");
    state = setDraft(state, "c1", "");
    expect(getDraft(state, "c1")).toBe("");
    expect(state.draftsByConversation).not.toHaveProperty("c1");
  });

  it("survives a round trip through save/load", () => {
    let state: AssistantState = emptyAssistantState();
    state = setDraft(state, "c1", "still here after reload");
    saveAssistantState(state);
    expect(getDraft(loadAssistantState(), "c1")).toBe("still here after reload");
  });

  it("deleting a conversation also removes its draft", () => {
    let state: AssistantState = emptyAssistantState();
    state = setDraft(state, "c1", "draft text");
    state = deleteConversation(state, "c1");
    expect(getDraft(state, "c1")).toBe("");
  });
});

describe("conversation/message CRUD", () => {
  it("creates a conversation and an empty message list for it", () => {
    const { state, conversation } = createConversation(emptyAssistantState(), "Test");
    expect(state.conversations[0]).toBe(conversation);
    expect(state.messagesByConversation[conversation.id]).toEqual([]);
  });

  it("adds a message and bumps the conversation's updatedAt", () => {
    const { state: s0, conversation } = createConversation(emptyAssistantState(), "Test");
    const message: AssistantMessage = {
      id: "m1",
      conversationId: conversation.id,
      role: "user",
      text: "hello",
      status: "sent",
      createdAt: 12345,
    };
    const s1 = addMessage(s0, message);
    expect(s1.messagesByConversation[conversation.id]).toEqual([message]);
    expect(s1.conversations[0].updatedAt).toBe(12345);
  });

  it("updateMessage patches only the targeted message", () => {
    const { state: s0, conversation } = createConversation(emptyAssistantState(), "Test");
    const a: AssistantMessage = { id: "a", conversationId: conversation.id, role: "user", text: "a", status: "sent", createdAt: 1 };
    const b: AssistantMessage = { id: "b", conversationId: conversation.id, role: "assistant", text: "", status: "streaming", createdAt: 2 };
    const s1 = addMessage(addMessage(s0, a), b);
    const s2 = updateMessage(s1, conversation.id, "b", { status: "error", errorMessage: "nope" });
    expect(s2.messagesByConversation[conversation.id]).toEqual([
      a,
      { ...b, status: "error", errorMessage: "nope" },
    ]);
  });
});
