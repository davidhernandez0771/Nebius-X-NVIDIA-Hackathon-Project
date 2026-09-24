// Built-in actions wrapping real, already-existing app handlers: page
// navigation and hand-cursor-control enable/disable. Coordinator-owned --
// registered once from App.tsx via registerBuiltinActions(). Modes'
// mode.activate action is registered separately by Worker 2's module (see
// SANT_VOICE_MODES_PLAN.md); this file only covers what already existed
// before this task.

import { registerAction } from "./registry";
import { getHandControlBridge } from "../hand/integration/handControlBridge";

// Every route a saved command/voice phrase can currently jump to. Several
// are room-scoped (?room_id=) in the real app; navigating without a room
// selected lands on that page's existing "pick a room first" EmptyState
// rather than failing silently -- that is honest, current behavior, not a
// new limitation introduced here.
export const NAV_DESTINATIONS = [
  "home",
  "room",
  "add-scan",
  "add-photo",
  "review",
  "inventory",
  "organize",
  "chat",
  "assistant",
  "voice",
  "commands",
  "modes",
  "settings",
] as const;
export type NavDestination = (typeof NAV_DESTINATIONS)[number];

const NAV_ROUTES: Record<NavDestination, string> = {
  home: "/home",
  room: "/room",
  "add-scan": "/add/scan",
  "add-photo": "/add/photo",
  review: "/review",
  inventory: "/inventory",
  organize: "/organize",
  chat: "/chat",
  assistant: "/assistant",
  voice: "/voice",
  commands: "/commands",
  modes: "/modes",
  settings: "/settings",
};

let registered = false;

/** Idempotent -- safe to call more than once (React StrictMode double-invokes effects). Actual registerAction() still throws on a genuine duplicate id from elsewhere, which is the behavior we want. */
export function registerBuiltinActions(): void {
  if (registered) return;
  registered = true;

  registerAction({
    id: "navigate",
    description: "go to a page in SANT",
    args: { destination: { type: "string", required: true, enum: NAV_DESTINATIONS } },
    isAvailable: () => true,
    execute: (args, ctx) => {
      const dest = args.destination as NavDestination;
      const path = NAV_ROUTES[dest];
      if (!path) return { ok: false, error: `Unknown destination "${String(args.destination)}"` };
      ctx.navigate(path);
      return { ok: true, message: `Opened ${dest.replace("-", " ")}` };
    },
  });

  registerAction({
    id: "hand_control.enable",
    description: "turn on hand-tracked cursor control",
    isAvailable: () => getHandControlBridge() !== null,
    execute: async () => {
      const bridge = getHandControlBridge();
      if (!bridge) return { ok: false, error: "Hand control isn't available on this page yet" };
      if (bridge.status().enabled) return { ok: true, message: "Hand control is already on" };
      await bridge.enable();
      return { ok: true, message: "Hand control turned on" };
    },
  });

  registerAction({
    id: "hand_control.disable",
    description: "turn off hand-tracked cursor control",
    isAvailable: () => getHandControlBridge() !== null,
    execute: () => {
      const bridge = getHandControlBridge();
      if (!bridge) return { ok: false, error: "Hand control isn't available on this page yet" };
      if (!bridge.status().enabled) return { ok: true, message: "Hand control is already off" };
      bridge.disable();
      return { ok: true, message: "Hand control turned off" };
    },
  });
}
