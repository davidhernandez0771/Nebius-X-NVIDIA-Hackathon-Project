// Tiny registry connecting the shared action registry to the single
// useHandPointer() instance mounted in App.tsx -- same pattern as
// ./activeScanViewer.ts (there is exactly one hand-pointer instance for the
// app's lifetime, mounted outside <Routes>, so a ref-through-context isn't
// needed). Populated by App.tsx (coordinator-owned); read by
// actions/builtins.ts's hand_control.enable/disable actions. Not part of
// the hand/ feature's own ownership (tracking/gesture/overlay) -- this file
// belongs to the action-registry integration, not the hand-control feature
// itself.

export interface HandControlBridge {
  status: () => { enabled: boolean };
  enable: () => Promise<void>;
  disable: () => void;
}

let active: HandControlBridge | null = null;

/** Called by App.tsx on every render (cheap -- just updates closures) and with null on unmount. Not for action code to call. */
export function registerHandControlBridge(bridge: HandControlBridge | null): void {
  active = bridge;
}

/** The current hand-pointer instance's control surface, or null if App.tsx hasn't mounted it yet. */
export function getHandControlBridge(): HandControlBridge | null {
  return active;
}
