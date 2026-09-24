// Implements MatchPhrase from ./types exactly (see the JSDoc there, it's the
// real spec). Pure functions only -- no DOM access, no storage reads. Worker
// 1's voice pipeline imports matchPhrase read-only; this module also exposes
// normalizePhrase/findPhraseConflicts for the Commands/Modes editor UIs to
// warn about a colliding phrase *before* it's saved, so the "ambiguous"
// runtime branch below stays a rare fallback rather than the normal path.

import { WAKE_WORD, type MatchPhrase, type MatchResult, type Mode, type SavedCommand } from "./types";

const PUNCTUATION_RE = /[.,!?;:'"()[\]{}]/g;
const WHITESPACE_RE = /\s+/g;

/** Lowercase, strip punctuation, collapse whitespace, trim. Does not touch
 * the wake word -- callers that need it stripped call stripWakeWord next. */
export function normalizePhrase(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(PUNCTUATION_RE, "")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

/** Removes a leading WAKE_WORD token from an already-normalized string, if
 * present. A transcript that is only the wake word strips to "". Safe to
 * call on a transcript that never had the wake word at all -- it's a no-op. */
export function stripWakeWord(normalized: string): string {
  if (normalized === WAKE_WORD) return "";
  const prefix = `${WAKE_WORD} `;
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length).trim();
  return normalized;
}

export type PhraseOwnerKind = "command" | "mode";

export interface PhraseOwner {
  kind: PhraseOwnerKind;
  id: string;
  /** displayName for a command, name for a mode. */
  label: string;
  /** The specific phrase or alias text that produced this row, as typed (not normalized). */
  phrase: string;
}

interface PhraseRow {
  normalized: string;
  owner: PhraseOwner;
}

/** Every enabled command's phrase + aliases, and every mode's optional
 * phrase, as flat (normalized, owner) rows -- the shared source of truth
 * both matchPhrase (runtime) and findPhraseConflicts (editor UI, save-time)
 * are built from, so the two can never disagree about what counts as a match. */
function collectPhraseRows(commands: SavedCommand[], modes: Mode[]): PhraseRow[] {
  const rows: PhraseRow[] = [];
  for (const command of commands) {
    if (!command.enabled) continue;
    const owner: PhraseOwner = { kind: "command", id: command.id, label: command.displayName, phrase: command.phrase };
    const texts = [command.phrase, ...command.aliases];
    for (const text of texts) {
      const normalized = normalizePhrase(text);
      if (!normalized) continue;
      rows.push({ normalized, owner: { ...owner, phrase: text } });
    }
  }
  for (const mode of modes) {
    if (!mode.phrase) continue;
    const normalized = normalizePhrase(mode.phrase);
    if (!normalized) continue;
    rows.push({ normalized, owner: { kind: "mode", id: mode.id, label: mode.name, phrase: mode.phrase } });
  }
  return rows;
}

/**
 * Save-time conflict check for the Commands/Modes editors: does `phrase`
 * (raw, as typed) collide with any *other* enabled command/mode phrase or
 * alias? Pass `exclude` (the item currently being edited) so a command
 * doesn't flag a conflict against its own unchanged phrase. Returns the
 * distinct owners it collides with (deduplicated by kind+id), empty when
 * there's no conflict or the phrase normalizes to nothing.
 */
export function findPhraseConflicts(
  phrase: string,
  commands: SavedCommand[],
  modes: Mode[],
  exclude?: { kind: PhraseOwnerKind; id: string },
): PhraseOwner[] {
  const target = normalizePhrase(phrase);
  if (!target) return [];
  const rows = collectPhraseRows(commands, modes).filter(
    (row) => row.normalized === target && !(exclude && row.owner.kind === exclude.kind && row.owner.id === exclude.id),
  );
  const seen = new Set<string>();
  const owners: PhraseOwner[] = [];
  for (const row of rows) {
    const key = `${row.owner.kind}:${row.owner.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push(row.owner);
  }
  return owners;
}

export const matchPhrase: MatchPhrase = (transcript, commands, modes) => {
  const target = stripWakeWord(normalizePhrase(transcript));
  if (!target) return { status: "unknown" };

  const rows = collectPhraseRows(commands, modes).filter((row) => row.normalized === target);
  const seen = new Set<string>();
  const matches: { kind: PhraseOwnerKind; id: string }[] = [];
  for (const row of rows) {
    const key = `${row.owner.kind}:${row.owner.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ kind: row.owner.kind, id: row.owner.id });
  }

  if (matches.length === 0) return { status: "unknown" };

  if (matches.length === 1) {
    const [match] = matches;
    if (match.kind === "command") {
      const command = commands.find((c) => c.id === match.id);
      if (command) return { status: "matched", kind: "command", command };
    } else {
      const mode = modes.find((m) => m.id === match.id);
      if (mode) return { status: "matched", kind: "mode", mode };
    }
    return { status: "unknown" };
  }

  const candidates = matches
    .map((match) => {
      if (match.kind === "command") return commands.find((c) => c.id === match.id)?.displayName;
      return modes.find((m) => m.id === match.id)?.name;
    })
    .filter((name): name is string => typeof name === "string");

  const result: MatchResult = { status: "ambiguous", candidates };
  return result;
};
