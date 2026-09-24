// Versioned localStorage persistence for SavedCommand[] and Mode[]. Mirrors
// the pattern in ../hand/integration/useHandPointer.ts's
// loadControlRegion/saveControlRegion: try/catch around every read/write,
// malformed or version-mismatched data recovers to an empty list, never
// throws. Kept behind the CommandsRepository interface so a later
// personal/workspace backend can be swapped in without touching the pages
// that consume it -- that backend is not built in this round.

import { COMMANDS_STORAGE_VERSION, MODES_STORAGE_VERSION, type Mode, type ModeLink, type SavedCommand } from "./types";

const COMMANDS_STORAGE_KEY = "sant.commands";
const MODES_STORAGE_KEY = "sant.modes";

export interface CommandsRepository {
  loadCommands(): SavedCommand[];
  saveCommands(commands: SavedCommand[]): void;
  loadModes(): Mode[];
  saveModes(modes: Mode[]): void;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isModeLink(v: unknown): v is ModeLink {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.id === "string" &&
    (l.kind === "external" || l.kind === "internal") &&
    typeof l.label === "string" &&
    typeof l.url === "string"
  );
}

function isSavedCommand(v: unknown): v is SavedCommand {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.displayName === "string" &&
    typeof c.phrase === "string" &&
    isStringArray(c.aliases) &&
    typeof c.actionId === "string" &&
    !!c.args &&
    typeof c.args === "object" &&
    typeof c.enabled === "boolean" &&
    typeof c.createdAt === "string" &&
    typeof c.updatedAt === "string"
  );
}

function isMode(v: unknown): v is Mode {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    Array.isArray(m.links) &&
    m.links.every(isModeLink) &&
    (m.phrase === undefined || typeof m.phrase === "string") &&
    typeof m.createdAt === "string" &&
    typeof m.updatedAt === "string"
  );
}

function loadVersioned<T>(key: string, version: number, isItem: (v: unknown) => v is T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== version || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.filter(isItem);
  } catch {
    return [];
  }
}

function saveVersioned<T>(key: string, version: number, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version, items }));
  } catch {
    // Private browsing / storage disabled / quota -- same as the hand
    // feature's persistence, this just won't survive a reload.
  }
}

export const localStorageCommandsRepository: CommandsRepository = {
  loadCommands: () => loadVersioned(COMMANDS_STORAGE_KEY, COMMANDS_STORAGE_VERSION, isSavedCommand),
  saveCommands: (commands) => saveVersioned(COMMANDS_STORAGE_KEY, COMMANDS_STORAGE_VERSION, commands),
  loadModes: () => loadVersioned(MODES_STORAGE_KEY, MODES_STORAGE_VERSION, isMode),
  saveModes: (modes) => saveVersioned(MODES_STORAGE_KEY, MODES_STORAGE_VERSION, modes),
};

let activeRepository: CommandsRepository = localStorageCommandsRepository;

/** The repository pages should call. A test/future backend can swap the
 * active instance via setCommandsRepository -- no page-level rewrite needed. */
export function getCommandsRepository(): CommandsRepository {
  return activeRepository;
}

/** Test-only / future-backend hook. Never call from app code outside a real backend swap. */
export function setCommandsRepository(repo: CommandsRepository): void {
  activeRepository = repo;
}

export function resetCommandsRepositoryForTests(): void {
  activeRepository = localStorageCommandsRepository;
}

export function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function upsertCommand(commands: SavedCommand[], command: SavedCommand): SavedCommand[] {
  const idx = commands.findIndex((c) => c.id === command.id);
  if (idx === -1) return [...commands, command];
  const next = commands.slice();
  next[idx] = command;
  return next;
}

export function removeCommand(commands: SavedCommand[], id: string): SavedCommand[] {
  return commands.filter((c) => c.id !== id);
}

export function upsertMode(modes: Mode[], mode: Mode): Mode[] {
  const idx = modes.findIndex((m) => m.id === mode.id);
  if (idx === -1) return [...modes, mode];
  const next = modes.slice();
  next[idx] = mode;
  return next;
}

export function removeMode(modes: Mode[], id: string): Mode[] {
  return modes.filter((m) => m.id !== id);
}

/** JSON export of everything this module owns, for a manual backup/restore.
 * Kept deliberately thin (no versioning UI, no merge) -- a real
 * import/export workflow is a bigger feature than this round calls for. */
export interface CommandsExport {
  version: 1;
  exportedAt: string;
  commands: SavedCommand[];
  modes: Mode[];
}

export function exportAll(): CommandsExport {
  const repo = getCommandsRepository();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    commands: repo.loadCommands(),
    modes: repo.loadModes(),
  };
}

/** Replaces stored commands/modes with whichever of the two keys are present
 * in `data`; a key that's missing or malformed leaves the existing stored
 * list untouched rather than wiping it. Silently drops malformed individual
 * entries the same way loadVersioned does, never throws. Returns how many of
 * each were actually written. */
export function importAll(data: unknown): { commands: number; modes: number } {
  if (!data || typeof data !== "object") return { commands: 0, modes: 0 };
  const d = data as Record<string, unknown>;
  const repo = getCommandsRepository();
  let commandsWritten = 0;
  let modesWritten = 0;
  if (Array.isArray(d.commands)) {
    const commands = d.commands.filter(isSavedCommand);
    repo.saveCommands(commands);
    commandsWritten = commands.length;
  }
  if (Array.isArray(d.modes)) {
    const modes = d.modes.filter(isMode);
    repo.saveModes(modes);
    modesWritten = modes.length;
  }
  return { commands: commandsWritten, modes: modesWritten };
}
