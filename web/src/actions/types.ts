// Shared action-registry contract (coordinator-owned, frozen for this
// round). Every voice command, custom command, mode, and future chat
// action executes through this registry -- it wraps REAL app handlers, so
// nothing here ever clicks a DOM element by guessing text, runs arbitrary
// JS/shell, or executes raw LLM output. See SANT_VOICE_MODES_PLAN.md.

export type ActionInputSource = "voice" | "hand" | "button" | "mode" | "chat" | "test";

export type ActionArgValue = string | number | boolean;
export type ActionArgs = Record<string, ActionArgValue | undefined>;

export type ActionArgSpec =
  | { type: "string"; required?: boolean; enum?: readonly string[] }
  | { type: "number"; required?: boolean; min?: number; max?: number }
  | { type: "boolean"; required?: boolean };

export type ActionArgSchema = Record<string, ActionArgSpec>;

export interface ActionContext {
  source: ActionInputSource;
  /** react-router's navigate(), supplied once at app bootstrap. Actions never import router hooks themselves, so they stay callable from non-component code (voice pipeline, tests). */
  navigate: (to: string) => void;
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export interface ActionDefinition {
  /** Stable id, dot-namespaced by feature, e.g. "navigate", "hand_control.enable", "mode.activate". Never reused for a different meaning. */
  id: string;
  /** Human-readable description shown in the command-builder UI ("When I say ..., Sant will <description>"). */
  description: string;
  args?: ActionArgSchema;
  /**
   * Metadata only -- the registry does not itself prompt. Callers (a
   * command's "test" button, a mode's "Activate" button, the voice
   * pipeline) decide how to honor this; see the plan for the policy this
   * round: UI entry points that trigger a flagged action always show an
   * explicit confirm/review step before calling executeAction, and voice
   * execution of a SAVED phrase relies on the user having already reviewed
   * that phrase's target when they created it (no separate runtime voice
   * confirmation prompt in this version -- documented, not silently skipped).
   */
  requiresConfirmation?: boolean;
  /** Availability/permission check, re-evaluated on every call (not cached). Return true even when the action would be a no-op (e.g. "already enabled") -- prefer idempotent execute() over refusing here; only refuse when the action is genuinely impossible right now (e.g. no bridge registered because the relevant UI isn't mounted). */
  isAvailable: (args: ActionArgs) => boolean;
  execute: (args: ActionArgs, ctx: ActionContext) => Promise<ActionResult> | ActionResult;
}
