// Entry points that keep three.js out of the main bundle: both load on first mount.

import { lazy, Suspense } from "react";
import type { HandArtOverlayProps } from "./HandArtOverlay";

export type { HandArtFrame, HandArtOverlayProps, HandArtStats } from "./HandArtOverlay";
export type { HandArtStyle } from "./styleCycle";

const Overlay = lazy(() => import("./HandArtOverlay"));
const Preview = lazy(() => import("./HandArtPreviewPage"));

/** The overlay, loaded on demand. Renders nothing until loaded, or without WebGL. */
export function LazyHandArtOverlay(props: HandArtOverlayProps) {
  return (
    <Suspense fallback={null}>
      <Overlay {...props} />
    </Suspense>
  );
}

/** The /pm/hand-art preview page, loaded on demand. */
export function HandArtPreviewRoute() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
