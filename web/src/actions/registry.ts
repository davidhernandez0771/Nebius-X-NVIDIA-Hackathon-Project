// Shared action registry (coordinator-owned). A single in-memory Map of
// ActionDefinition, registered at app bootstrap by builtins.ts and by each
// feature module that owns a real handler (hand control, modes). Workers:
// import registerAction/getAction/listActions/executeAction -- do not edit
// this file; request changes to the registry's shape through the
// coordinator. See SANT_VOICE_MODES_PLAN.md and ./types.ts (the actual spec).

import type { ActionArgs, ActionArgSchema, ActionContext, ActionDefinition, ActionResult } from "./types";

const registry = new Map<string, ActionDefinition>();

/** Throws on a duplicate id -- a silent overwrite would let one feature's action shadow another's without anyone noticing. */
export function registerAction(def: ActionDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`Action "${def.id}" is already registered`);
  }
  registry.set(def.id, def);
}

export function getAction(id: string): ActionDefinition | undefined {
  return registry.get(id);
}

export function listActions(): ActionDefinition[] {
  return Array.from(registry.values());
}

export function validateArgs(schema: ActionArgSchema | undefined, args: ActionArgs): string[] {
  const errors: string[] = [];
  if (!schema) return errors;
  for (const [key, spec] of Object.entries(schema)) {
    const value = args[key];
    if (value === undefined) {
      if (spec.required) errors.push(`Missing required argument "${key}"`);
      continue;
    }
    if (spec.type === "string") {
      if (typeof value !== "string") errors.push(`"${key}" must be a string`);
      else if (spec.enum && !spec.enum.includes(value)) errors.push(`"${key}" must be one of: ${spec.enum.join(", ")}`);
    } else if (spec.type === "number") {
      if (typeof value !== "number") errors.push(`"${key}" must be a number`);
      else {
        if (spec.min !== undefined && value < spec.min) errors.push(`"${key}" must be >= ${spec.min}`);
        if (spec.max !== undefined && value > spec.max) errors.push(`"${key}" must be <= ${spec.max}`);
      }
    } else if (spec.type === "boolean" && typeof value !== "boolean") {
      errors.push(`"${key}" must be a boolean`);
    }
  }
  return errors;
}

/**
 * The single execution path for every input source. Validates args against
 * the action's schema, checks isAvailable(), then runs execute() -- never
 * lets an unregistered id, a bad argument, or a thrown error propagate as
 * anything other than a typed ActionResult, so every caller (voice,
 * command test button, mode activation) gets a meaningful, displayable
 * error instead of an exception.
 */
export async function executeAction(id: string, args: ActionArgs, ctx: ActionContext): Promise<ActionResult> {
  const def = registry.get(id);
  if (!def) return { ok: false, error: `Unknown action "${id}"` };

  const errors = validateArgs(def.args, args);
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };

  if (!def.isAvailable(args)) return { ok: false, error: `"${def.description}" isn't available right now` };

  try {
    return await def.execute(args, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Test-only: clears every registration so each test file starts from a clean registry. Never call from app code. */
export function __resetRegistryForTests(): void {
  registry.clear();
}
