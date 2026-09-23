// Tiny registry connecting the app-root hand-pointer integration to
// whichever ScanViewer instance is currently mounted (there is at most one
// on screen at a time -- RoomView.tsx is the only place it's used). Avoids
// threading a ref through DashboardShell's <Outlet /> for a single consumer.

import type { ScanViewerHandle } from "../../three/ScanViewer";

let active: ScanViewerHandle | null = null;

/** Called by ScanViewer itself on mount/unmount. Not for integration code to call. */
export function registerScanViewer(handle: ScanViewerHandle | null): void {
  active = handle;
}

/** The currently-mounted ScanViewer's imperative handle, or null if none is on screen. */
export function getActiveScanViewer(): ScanViewerHandle | null {
  return active;
}
