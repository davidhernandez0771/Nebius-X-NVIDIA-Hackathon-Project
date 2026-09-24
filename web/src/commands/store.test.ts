import { beforeEach, describe, expect, it } from "vitest";
import {
  exportAll,
  importAll,
  localStorageCommandsRepository,
  removeCommand,
  removeMode,
  upsertCommand,
  upsertMode,
} from "./store";
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

beforeEach(() => {
  localStorage.clear();
});

describe("localStorageCommandsRepository", () => {
  it("round-trips commands through save/load", () => {
    localStorageCommandsRepository.saveCommands([command()]);
    expect(localStorageCommandsRepository.loadCommands()).toEqual([command()]);
  });

  it("round-trips modes through save/load", () => {
    localStorageCommandsRepository.saveModes([mode()]);
    expect(localStorageCommandsRepository.loadModes()).toEqual([mode()]);
  });

  it("returns an empty array when nothing is stored yet", () => {
    expect(localStorageCommandsRepository.loadCommands()).toEqual([]);
    expect(localStorageCommandsRepository.loadModes()).toEqual([]);
  });

  it("recovers to an empty array from malformed JSON rather than throwing", () => {
    localStorage.setItem("sant.commands", "{not json");
    expect(() => localStorageCommandsRepository.loadCommands()).not.toThrow();
    expect(localStorageCommandsRepository.loadCommands()).toEqual([]);
  });

  it("recovers to an empty array on a storage-version mismatch", () => {
    localStorage.setItem("sant.commands", JSON.stringify({ version: 999, items: [command()] }));
    expect(localStorageCommandsRepository.loadCommands()).toEqual([]);
  });

  it("drops individually malformed entries but keeps the well-formed ones", () => {
    localStorage.setItem(
      "sant.commands",
      JSON.stringify({ version: 1, items: [command(), { id: "broken" }] }),
    );
    expect(localStorageCommandsRepository.loadCommands()).toEqual([command()]);
  });
});

describe("upsert/remove helpers", () => {
  it("upsertCommand appends a new command", () => {
    expect(upsertCommand([], command())).toEqual([command()]);
  });

  it("upsertCommand replaces an existing command by id", () => {
    const updated = command({ displayName: "Renamed" });
    expect(upsertCommand([command()], updated)).toEqual([updated]);
  });

  it("removeCommand filters by id", () => {
    expect(removeCommand([command()], "cmd-1")).toEqual([]);
  });

  it("upsertMode and removeMode behave the same way for modes", () => {
    expect(upsertMode([], mode())).toEqual([mode()]);
    const updated = mode({ name: "Renamed" });
    expect(upsertMode([mode()], updated)).toEqual([updated]);
    expect(removeMode([mode()], "mode-1")).toEqual([]);
  });
});

describe("exportAll / importAll", () => {
  it("exports whatever is currently stored", () => {
    localStorageCommandsRepository.saveCommands([command()]);
    localStorageCommandsRepository.saveModes([mode()]);
    const exported = exportAll();
    expect(exported.commands).toEqual([command()]);
    expect(exported.modes).toEqual([mode()]);
  });

  it("imports commands and modes, dropping malformed entries", () => {
    const result = importAll({ commands: [command(), { bad: true }], modes: [mode()] });
    expect(result).toEqual({ commands: 1, modes: 1 });
    expect(localStorageCommandsRepository.loadCommands()).toEqual([command()]);
    expect(localStorageCommandsRepository.loadModes()).toEqual([mode()]);
  });

  it("leaves existing modes untouched when the import payload has no modes key", () => {
    localStorageCommandsRepository.saveModes([mode()]);
    importAll({ commands: [] });
    expect(localStorageCommandsRepository.loadModes()).toEqual([mode()]);
  });

  it("never throws on a completely malformed import payload", () => {
    expect(() => importAll("not an object")).not.toThrow();
    expect(importAll(null)).toEqual({ commands: 0, modes: 0 });
  });
});
