// Registers mode.activate (see SANT_VOICE_MODES_PLAN.md §3) -- the coordinator
// calls registerModeActivateAction() once from App.tsx during integration,
// same as builtins.ts's registerBuiltinActions(). This is the ONLY action
// this module registers; mode.activate wraps launchMode from ./modes.ts, it
// doesn't reimplement launch logic.

import { registerAction } from "../actions/registry";
import type { ActionArgs, ActionContext, ActionResult } from "../actions/types";
import { launchMode } from "./modes";
import { getCommandsRepository } from "./store";

let registered = false;

/** Idempotent, same pattern as registerBuiltinActions() -- safe under React
 * StrictMode's double-invoked effects. registerAction() itself still throws
 * on a genuine duplicate id from elsewhere. */
export function registerModeActivateAction(): void {
  if (registered) return;
  registered = true;

  registerAction({
    id: "mode.activate",
    description: "activate a saved mode (open its links)",
    args: { modeId: { type: "string", required: true } },
    // Metadata only (registry never prompts, see actions/types.ts). ModesPage's
    // Activate button honors this with the required "show contents before
    // activation" review step; a voice-triggered activation relies on the
    // phrase having been deliberately configured in that same UI, where the
    // link list was already reviewed -- there is no separate runtime voice
    // confirmation state machine in this version.
    requiresConfirmation: true,
    isAvailable: (args: ActionArgs) => {
      const modeId = args.modeId;
      return typeof modeId === "string" && getCommandsRepository().loadModes().some((m) => m.id === modeId);
    },
    execute: (args: ActionArgs, ctx: ActionContext): ActionResult => {
      const modeId = args.modeId as string;
      const mode = getCommandsRepository().loadModes().find((m) => m.id === modeId);
      if (!mode) return { ok: false, error: `Mode "${modeId}" no longer exists` };
      if (mode.links.length === 0) return { ok: true, message: `"${mode.name}" has no links to open` };

      const launch = launchMode(mode, ctx.navigate);
      const openedCount = launch.results.filter((r) => r.status === "opened").length;
      const total = launch.results.length;

      if (openedCount === 0) {
        return {
          ok: false,
          error: `"${mode.name}" activation was blocked -- 0 of ${total} link(s) opened. Open the Modes page to retry individually.`,
        };
      }
      if (openedCount < total) {
        return {
          ok: true,
          message: `"${mode.name}" activated -- opened ${openedCount} of ${total} link(s); the rest need a manual retry on the Modes page.`,
        };
      }
      return { ok: true, message: `"${mode.name}" activated -- opened ${total} link${total === 1 ? "" : "s"}.` };
    },
  });
}

export function __resetModeActivateRegistrationForTests(): void {
  registered = false;
}
