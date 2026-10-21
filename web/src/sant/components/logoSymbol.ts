// THE LOGO SYMBOL, in one swappable place. Everything that shows the logo (Logo, the navs, the world's
// brand, the dust power-on) draws these paths, so replacing the symbol means editing only this file.
//
// The user's mark, the open-corner tesseract (docs/design/logo/sant-mark.svg in the main checkout,
// copied to web/public/brand/): an open hexagon frame, corner lines running in from five of its
// corners, and the inner cube they reach, in the accent. Drawn in round-capped strokes, as the file is.
//
// To swap in another symbol: set `viewBox`, `units` (path data, one entry per part, in the order the
// parts should light: S → A → N → T), the parts in the `accent`, and the `stroke` width (0: filled).

export type LogoSymbol = {
  /** The SVG viewBox, "minX minY width height". */
  viewBox: string;
  /** Path data per part, in lighting order. */
  units: readonly string[];
  /** The parts drawn in the accent; the rest take the ink. */
  accent: readonly number[];
  /** The stroke width in viewBox units (round caps and joins); 0 fills the paths instead. */
  stroke: number;
};

export const LOGO_SYMBOL: LogoSymbol = {
  // The file's viewBox is -55 -55 110 110; this is its lines' own box (their stroke included), so the
  // lockup sits as tight to the wordmark as the sheet's.
  viewBox: "-41.2 -47.1 82.4 94.2",
  units: [
    // The open frame: a hexagon with its top-right corner left open.
    "M38.11 -7.04L38.11 22L0 44L-38.11 22L-38.11 -22L0 -44L25.15 -29.48",
    // The corner lines, from five of the frame's corners in to the cube.
    "M0 -44L7 -25M38.11 22L23.45 3.5M0 44L7 13M-38.11 22L-9.45 3.5M-38.11 -22L-9.45 -15.5",
    // The inner cube's outline...
    "M7 -25L23.45 -15.5L23.45 3.5L7 13L-9.45 3.5L-9.45 -15.5Z",
    // ...and its near corner.
    "M7 -6L23.45 -15.5M7 -6L7 13M7 -6L-9.45 -15.5",
  ],
  accent: [2, 3],
  stroke: 5.2,
};
