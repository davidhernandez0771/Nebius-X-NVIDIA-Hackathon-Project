import { describe, expect, it } from "vitest";
import { findPhraseConflicts, matchPhrase, normalizePhrase, stripWakeWord } from "./matcher";
import type { Mode, SavedCommand } from "./types";

function command(overrides: Partial<SavedCommand> = {}): SavedCommand {
  return {
    id: "cmd-1",
    displayName: "Camera control",
    phrase: "activate camera control",
    aliases: [],
    actionId: "hand_control.enable",
    args: {},
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mode(overrides: Partial<Mode> = {}): Mode {
  return {
    id: "mode-1",
    name: "Focus mode",
    links: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizePhrase", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizePhrase("  Activate, Camera-Control!!  ")).toBe("activate camera-control");
  });

  it("collapses repeated internal whitespace to a single space", () => {
    expect(normalizePhrase("go   home")).toBe("go home");
  });

  it("strips quotes and terminal punctuation", () => {
    expect(normalizePhrase(`"Turn off hand control."`)).toBe("turn off hand control");
  });
});

describe("stripWakeWord", () => {
  it("strips a leading wake-word token", () => {
    expect(stripWakeWord("sant activate camera control")).toBe("activate camera control");
  });

  it("reduces a lone wake word to an empty string", () => {
    expect(stripWakeWord("sant")).toBe("");
  });

  it("leaves a transcript with no wake word unchanged", () => {
    expect(stripWakeWord("activate camera control")).toBe("activate camera control");
  });

  it("does not strip the wake word when it's not a standalone leading token", () => {
    expect(stripWakeWord("santa claus is coming")).toBe("santa claus is coming");
  });
});

describe("matchPhrase", () => {
  it("matches an enabled command's canonical phrase, with or without the wake word", () => {
    const commands = [command()];
    expect(matchPhrase("sant activate camera control", commands, [])).toEqual({
      status: "matched",
      kind: "command",
      command: commands[0],
    });
    expect(matchPhrase("activate camera control", commands, [])).toEqual({
      status: "matched",
      kind: "command",
      command: commands[0],
    });
  });

  it("matches on an alias, normalized the same way as the canonical phrase", () => {
    const commands = [command({ aliases: ["Hand Control, ON!"] })];
    expect(matchPhrase("sant hand control on", commands, [])).toEqual({
      status: "matched",
      kind: "command",
      command: commands[0],
    });
  });

  it("ignores a disabled command entirely", () => {
    const commands = [command({ enabled: false })];
    expect(matchPhrase("sant activate camera control", commands, [])).toEqual({ status: "unknown" });
  });

  it("matches a mode's voice phrase", () => {
    const modes = [mode({ phrase: "start focus mode" })];
    expect(matchPhrase("sant start focus mode", [], modes)).toEqual({
      status: "matched",
      kind: "mode",
      mode: modes[0],
    });
  });

  it("ignores a mode with no phrase configured", () => {
    const modes = [mode()];
    expect(matchPhrase("sant start focus mode", [], modes)).toEqual({ status: "unknown" });
  });

  it("returns unknown for the wake word alone", () => {
    expect(matchPhrase("sant", [command()], [])).toEqual({ status: "unknown" });
  });

  it("returns unknown for an unrecognized transcript, never a fuzzy guess", () => {
    const commands = [command({ phrase: "activate camera control" })];
    expect(matchPhrase("sant activate the camera", commands, [])).toEqual({ status: "unknown" });
  });

  it("returns ambiguous, listing every conflicting display name, when a command and a mode share a phrase", () => {
    const commands = [command({ phrase: "start it", displayName: "Command A" })];
    const modes = [mode({ phrase: "start it", name: "Mode B" })];
    const result = matchPhrase("sant start it", commands, modes);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.sort()).toEqual(["Command A", "Mode B"]);
    }
  });

  it("returns ambiguous when a phrase collides with a different command's alias", () => {
    const commands = [
      command({ id: "cmd-a", phrase: "go home", displayName: "Command A" }),
      command({ id: "cmd-b", phrase: "different", aliases: ["go home"], displayName: "Command B" }),
    ];
    const result = matchPhrase("sant go home", commands, []);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.sort()).toEqual(["Command A", "Command B"]);
    }
  });

  it("does not double-count a phrase matching both a command's canonical phrase and its own alias", () => {
    const commands = [command({ phrase: "go home", aliases: ["go home"] })];
    const result = matchPhrase("sant go home", commands, []);
    expect(result).toEqual({ status: "matched", kind: "command", command: commands[0] });
  });
});

describe("findPhraseConflicts", () => {
  it("reports no conflict for a phrase nothing else uses", () => {
    expect(findPhraseConflicts("brand new phrase", [command()], [])).toEqual([]);
  });

  it("reports a conflict against another enabled command's phrase", () => {
    const other = command({ id: "cmd-2", phrase: "go home", displayName: "Other command" });
    const conflicts = findPhraseConflicts("go home", [other], []);
    expect(conflicts).toEqual([{ kind: "command", id: "cmd-2", label: "Other command", phrase: "go home" }]);
  });

  it("excludes the item currently being edited from its own conflict check", () => {
    const self = command({ id: "cmd-1", phrase: "go home" });
    const conflicts = findPhraseConflicts("go home", [self], [], { kind: "command", id: "cmd-1" });
    expect(conflicts).toEqual([]);
  });

  it("ignores a disabled command when checking for conflicts", () => {
    const disabled = command({ id: "cmd-2", phrase: "go home", enabled: false });
    expect(findPhraseConflicts("go home", [disabled], [])).toEqual([]);
  });

  it("reports a conflict against a mode's phrase", () => {
    const m = mode({ id: "mode-2", phrase: "go home", name: "Home mode" });
    const conflicts = findPhraseConflicts("go home", [], [m]);
    expect(conflicts).toEqual([{ kind: "mode", id: "mode-2", label: "Home mode", phrase: "go home" }]);
  });

  it("returns an empty array for a phrase that normalizes to nothing", () => {
    expect(findPhraseConflicts("   !!!  ", [command()], [])).toEqual([]);
  });
});
