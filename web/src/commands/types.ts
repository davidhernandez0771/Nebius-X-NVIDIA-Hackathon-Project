// Shared contract for saved custom commands and modes (coordinator-owned,
// frozen for this round). Worker 2 implements storage, matching and UI
// against this; Worker 1 (voice) only imports these types plus the
// MatchPhrase signature -- neither worker edits this file. Request changes
// through the coordinator. See SANT_VOICE_MODES_PLAN.md.

import type { ActionArgs } from "../actions/types";

/** The single wake-word string, lowercased. Both the voice module (arming the command window) and the matcher (stripping the prefix from a transcript before comparing) read this same constant so the policy can never drift between the two. */
export const WAKE_WORD = "sant";

export interface SavedCommand {
  id: string;
  displayName: string;
  /** Canonical trigger phrase, WITHOUT the wake word, e.g. "activate camera control". Normalized (case/punctuation/whitespace) the same way by the matcher before comparison, never stored pre-normalized so the UI can still show it as the user typed it. */
  phrase: string;
  /** Additional phrases that also trigger this command, same normalization rules as `phrase`. */
  aliases: string[];
  /** An ActionDefinition.id from actions/registry.ts. */
  actionId: string;
  args: ActionArgs;
  enabled: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type ModeLinkKind = "external" | "internal";

export interface ModeLink {
  id: string;
  kind: ModeLinkKind;
  label: string;
  /** external: a full https:// (or http://) URL, validated before save/launch, "javascript:" and other unsafe schemes rejected. internal: an app-relative path starting with "/". */
  url: string;
}

export interface Mode {
  id: string;
  name: string;
  links: ModeLink[];
  /** Optional voice phrase for this mode, routed through the same command-matching pipeline as SavedCommand.phrase (see MatchResult below) -- a mode is not a second kind of trigger, it's a second kind of match target. */
  phrase?: string;
  createdAt: string;
  updatedAt: string;
}

export type MatchResult =
  | { status: "matched"; kind: "command"; command: SavedCommand }
  | { status: "matched"; kind: "mode"; mode: Mode }
  /** More than one enabled command/mode phrase or alias matches the same normalized transcript. Conflict detection at save-time (Worker 2's command/mode editor) should make this rare in practice; this is the runtime fallback when it still happens. */
  | { status: "ambiguous"; candidates: string[] } // display names of every conflicting match
  | { status: "unknown" };

/**
 * Implemented by Worker 2 in commands/matcher.ts. A pure function: no DOM
 * access, no storage reads -- the caller (voice module) passes in the
 * current command/mode lists it already has. Must normalize case,
 * punctuation and whitespace, and strip a leading WAKE_WORD prefix (per the
 * shared policy) before comparing against phrases/aliases. Never falls back
 * to a fuzzy "closest guess" for a real command match -- no match found and
 * no exact/normalized match means "unknown", not a guess.
 */
export type MatchPhrase = (transcript: string, commands: SavedCommand[], modes: Mode[]) => MatchResult;

export const COMMANDS_STORAGE_VERSION = 1;
export const MODES_STORAGE_VERSION = 1;
