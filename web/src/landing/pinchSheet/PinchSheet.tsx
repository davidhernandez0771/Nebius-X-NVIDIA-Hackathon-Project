// "Try a pinch": a small cloth sheet printed with SANT that you can pinch and drag, for the landing
// page. Mouse and touch work out of the box; pass `hand` to let a webcam hand pinch it too.
//
// The cloth (three.js via react-three-fiber) loads lazily and only when it can run: with reduced
// motion, or without WebGL, the sheet is shown flat and still, as an SVG of the same print. That
// still print also stays under the canvas until its first frame is drawn, so there is no blank
// box or flash while the 3D code loads.
//
// Wiring the app's hand cursor (landing page, later):
//   const hand = useHandPointer();
//   <PinchSheet hand={{ point: hand.cursor, pinching: hand.isSelecting }} />
// `point` is in viewport CSS pixels, the same space as clientX/Y and HandPointerState.cursor.

import { lazy, Suspense, useMemo, useState, type CSSProperties } from "react";
import { hasWebGL, prefersReducedMotion } from "../../three/capability";
import { printSvg } from "./print";
import type { HandPinch } from "./pinchInput";
import { SHEET_FILL } from "./sheetGeometry";

const LiveSheet = lazy(() => import("./LiveSheet"));

export type { HandPinch } from "./pinchInput";

export interface PinchSheetProps {
  /** An optional hand-pinch input (e.g. the webcam hand cursor); null/undefined when there is none. */
  hand?: HandPinch | null;
  /** Overrides prefers-reduced-motion. True shows the still sheet. */
  reducedMotion?: boolean;
  /** Called when the sheet is picked up (true) and let go (false). */
  onHoldChange?: (holding: boolean) => void;
  className?: string;
  /** The box the sheet sits in; it defaults to a 16:11 box as wide as its container. */
  style?: CSSProperties;
}

export default function PinchSheet({ hand, reducedMotion, onHoldChange, className, style }: PinchSheetProps) {
  const still = reducedMotion ?? prefersReducedMotion();
  const live = useMemo(() => !still && hasWebGL(), [still]);
  const [ready, setReady] = useState(false);
  const box: CSSProperties = { position: "relative", width: "100%", aspectRatio: "16 / 11", ...style };

  const stillSheet = <StillSheet key="still" />;
  return (
    <div
      className={className}
      style={box}
      role="img"
      aria-label={live ? "A fabric sheet printed with SANT. Drag it to pinch the cloth." : "A fabric sheet printed with SANT."}
      data-mode={live ? "live" : "still"}
    >
      {(!live || !ready) && stillSheet}
      {live && (
        <Suspense fallback={null}>
          <LiveSheet hand={hand ?? null} onHoldChange={onHoldChange} onReady={() => setReady(true)} />
        </Suspense>
      )}
    </div>
  );
}

/** The flat print, sized and centred like the live sheet at rest. */
function StillSheet() {
  const svg = useMemo(() => printSvg(1024, 640), []);
  return (
    <div
      data-part="still-sheet"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${SHEET_FILL * 100}%`,
        aspectRatio: "16 / 10",
        transform: "translate(-50%, -50%)",
        maxHeight: `${SHEET_FILL * 100}%`,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
