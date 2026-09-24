// Synthetic-transcript-event tests -- no live microphone or speech engine
// involved (see SANT_VOICE_MODES_PLAN.md §5/§7: no physical mic is
// available in this environment). matchPhrase is injected as a fake
// (commandListening.ts never imports the real ../commands/matcher -- see
// that file's header), and executeAction is the REAL registry from
// ../actions/registry, with a test-only action registered per test so this
// also exercises the real wake -> match -> execute path end to end.
//
// Uses real timers throughout (a single macrotask tick reliably drains any
// number of chained microtasks from the async match/execute path, which is
// simpler and less fragile here than fake-timer/microtask interleaving).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRegistryForTests, registerAction } from "../actions/registry";
import type { ActionContext, ActionResult } from "../actions/types";
import type { MatchPhrase, MatchResult, Mode, SavedCommand } from "../commands/types";
import { createCommandListener, type CommandListenerEvents } from "./commandListening";
import type { VoiceListeningState } from "./types";

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCommand(overrides: Partial<SavedCommand> = {}): SavedCommand {
  return {
    id: "cmd-1",
    displayName: "Turn on hand control",
    phrase: "activate camera control",
    aliases: [],
    actionId: "test.echo",
    args: {},
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMode(overrides: Partial<Mode> = {}): Mode {
  return {
    id: "mode-1",
    name: "Focus mode",
    links: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function collectEvents() {
  const states: VoiceListeningState[] = [];
  const results: ActionResult[] = [];
  const recognized: { transcript: string; matchedActionId: string | null; matchedLabel: string | null }[] = [];
  const events: CommandListenerEvents = {
    onStateChange: (s) => states.push(s),
    onRecognized: (e) => recognized.push(e),
    onResult: (r) => results.push(r),
  };
  return { events, states, results, recognized };
}

describe("createCommandListener", () => {
  let executeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetRegistryForTests();
    executeSpy = vi.fn((_args, ctx: ActionContext): ActionResult => {
      ctx.navigate("/somewhere");
      return { ok: true, message: "did the thing" };
    });
    registerAction({
      id: "test.echo",
      description: "test action",
      isAvailable: () => true,
      execute: executeSpy,
    });
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it("ignores transcripts with no wake word and never matches/executes", async () => {
    const { events, states, results, recognized } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn();
    const navigate = vi.fn();
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [makeCommand()], getModes: () => [], navigate },
      events,
    );

    listener.handleTranscript({ transcript: "go to the inventory page", isFinal: true });
    await tick();

    expect(matchPhrase).not.toHaveBeenCalled();
    expect(states).toEqual([]);
    expect(results).toEqual([]);
    expect(recognized).toEqual([]);
  });

  it("never executes on an interim (non-final) transcript, even once armed", async () => {
    const { events, results } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn();
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn() },
      events,
    );

    listener.handleTranscript({ transcript: "sant", isFinal: false });
    listener.handleTranscript({ transcript: "activate camera control", isFinal: false });
    await tick();

    expect(matchPhrase).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("wake word + final command in the same chunk matches and executes immediately", async () => {
    const { events, states, results, recognized } = collectEvents();
    const command = makeCommand();
    const matched: MatchResult = { status: "matched", kind: "command", command };
    const matchPhrase: MatchPhrase = vi.fn().mockReturnValue(matched);
    const navigate = vi.fn();
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [command], getModes: () => [], navigate },
      events,
    );

    listener.handleTranscript({ transcript: "sant activate camera control", isFinal: true });
    await tick();

    expect(matchPhrase).toHaveBeenCalledWith("activate camera control", [command], []);
    expect(executeSpy).toHaveBeenCalledWith({}, { source: "voice", navigate });
    expect(recognized).toEqual([{ transcript: "activate camera control", matchedActionId: "test.echo", matchedLabel: command.displayName }]);
    expect(results).toEqual([{ ok: true, message: "did the thing" }]);
    expect(states).toEqual(["transcribing", "executing", "success"]);
  });

  it("wake word alone arms the window, then a later final chunk finalizes it", async () => {
    const { events, states, recognized } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn().mockReturnValue({ status: "unknown" });
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn() },
      events,
    );

    listener.handleTranscript({ transcript: "sant", isFinal: true });
    expect(states).toEqual(["wake-detected"]);

    listener.handleTranscript({ transcript: "go home", isFinal: true });
    await tick();

    expect(matchPhrase).toHaveBeenCalledWith("go home", [], []);
    expect(recognized).toEqual([{ transcript: "go home", matchedActionId: null, matchedLabel: null }]);
    expect(states).toEqual(["wake-detected", "transcribing", "executing", "error"]);
  });

  it("times out an armed window with no speech and returns to listening without matching", async () => {
    const { events, states } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn();
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn(), commandWindowMs: 15 },
      events,
    );

    listener.handleTranscript({ transcript: "sant", isFinal: true });
    await tick(40);

    expect(matchPhrase).not.toHaveBeenCalled();
    expect(states).toEqual(["wake-detected", "listening"]);
  });

  it("reports ambiguous matches as a non-ok result without executing anything", async () => {
    const { events, results } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn().mockReturnValue({ status: "ambiguous", candidates: ["A", "B"] });
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn() },
      events,
    );

    listener.handleTranscript({ transcript: "sant do the thing", isFinal: true });
    await tick();

    expect(executeSpy).not.toHaveBeenCalled();
    expect(results).toEqual([{ ok: false, error: "More than one command matches: A, B" }]);
  });

  it("matches a mode and dispatches mode.activate with its modeId", async () => {
    registerAction({
      id: "mode.activate",
      description: "activate a mode",
      isAvailable: () => true,
      execute: executeSpy,
    });
    const { events, recognized } = collectEvents();
    const mode = makeMode();
    const matchPhrase: MatchPhrase = vi.fn().mockReturnValue({ status: "matched", kind: "mode", mode });
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [mode], navigate: vi.fn() },
      events,
    );

    listener.handleTranscript({ transcript: "sant focus mode", isFinal: true });
    await tick();

    expect(executeSpy).toHaveBeenCalledWith({ modeId: mode.id }, expect.objectContaining({ source: "voice" }));
    expect(recognized).toEqual([{ transcript: "focus mode", matchedActionId: "mode.activate", matchedLabel: mode.name }]);
  });

  it("push-to-talk (armManually) arms without a wake word, and finalizeNow finalizes on release", async () => {
    const { events, states, recognized } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn().mockReturnValue({ status: "unknown" });
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn() },
      events,
    );

    listener.armManually();
    expect(states).toEqual(["wake-detected"]);

    listener.handleTranscript({ transcript: "some command", isFinal: false });
    listener.finalizeNow();
    await tick();

    expect(matchPhrase).toHaveBeenCalledWith("some command", [], []);
    expect(recognized).toEqual([{ transcript: "some command", matchedActionId: null, matchedLabel: null }]);
  });

  it("reset() cancels an armed window without matching or executing", async () => {
    const { events, states } = collectEvents();
    const matchPhrase: MatchPhrase = vi.fn();
    const listener = createCommandListener(
      { matchPhrase, getCommands: () => [], getModes: () => [], navigate: vi.fn() },
      events,
    );

    listener.handleTranscript({ transcript: "sant", isFinal: true });
    listener.reset();
    listener.finalizeNow(); // no-op: not armed anymore
    await tick();

    expect(matchPhrase).not.toHaveBeenCalled();
    expect(states).toEqual(["wake-detected"]);
  });
});
