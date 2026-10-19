// Tiny registry connecting the app-root hand-pointer integration to
// whichever zoomable 3D viewer is currently mounted (at most one on screen at a
// time). The room organizer's ScanViewer was its only user; the interface
// lives here so the two-hand zoom path no longer depends on that viewer.

/**
 * Imperative zoom API for the two-hand pinch-to-zoom gesture (see
 * HAND_INTERACTION_PLAN.md GOAL 2). A viewer drives the same camera-distance
 * dolly a mouse wheel would, never a CSS transform on its container.
 */
export interface ScanViewerHandle {
  /** Current distance from the camera to the orbit target. */
  getDistance(): number;
  /** Clamped to [minDistance, maxDistance]; preserves the current orbit target and view direction. */
  setDistance(distance: number): void;
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Suppresses/restores mouse-wheel zoom, drag-orbit and pan while a hand gesture is driving the camera directly. */
  setOrbitEnabled(enabled: boolean): void;
}

let active: ScanViewerHandle | null = null;

/** Called by the viewer itself on mount/unmount. Not for integration code to call. */
export function registerScanViewer(handle: ScanViewerHandle | null): void {
  active = handle;
}

/** The currently-mounted viewer's imperative handle, or null if none is on screen. */
export function getActiveScanViewer(): ScanViewerHandle | null {
  return active;
}
