// Preview route for the pinch sheet (/landing/pinch-sheet): the component alone on a paper page,
// so it can be tried and reviewed before the landing page places it.

import { useState } from "react";
import { prefersReducedMotion } from "../../three/capability";
import PinchSheet from "./PinchSheet";
import { PAPER } from "./print";
import { SHEET_FILL } from "./sheetGeometry";

// The default 16:11 box is wider than the sheet's room needs, so the resting sheet is limited by
// width: it starts SIDE of the box's width in from the left and ends BELOW above the box's bottom
// (both as fractions of the width, which is what CSS % margins use). The hint lines up under it.
const SIDE = (1 - SHEET_FILL) / 2;
const BELOW = (11 / 16 - (SHEET_FILL * 10) / 16) / 2;

export default function PinchSheetPreview() {
  const [holding, setHolding] = useState(false);
  const still = prefersReducedMotion() || new URLSearchParams(location.search).has("static");

  return (
    <main
      style={{
        minHeight: "100vh",
        background: PAPER.ground,
        color: PAPER.ink,
        fontFamily: '"Geist", "Inter", "Segoe UI", system-ui, sans-serif',
        padding: "clamp(24px, 6vw, 72px) 16px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <PinchSheet reducedMotion={still} onHoldChange={setHolding} />
        <p
          aria-live="polite"
          style={{
            position: "relative",
            pointerEvents: "none",
            margin: `calc(${(-BELOW * 100).toFixed(3)}% + 16px) 0 0 ${(SIDE * 100).toFixed(3)}%`,
            fontSize: 15,
            lineHeight: 1.5,
            color: holding ? PAPER.accentInk : PAPER.muted,
          }}
        >
          {still
            ? "Motion is reduced, so the sheet stays still."
            : holding
              ? "Let go and it lies flat again."
              : "Grab the sheet and pull."}
        </p>
      </div>
    </main>
  );
}
