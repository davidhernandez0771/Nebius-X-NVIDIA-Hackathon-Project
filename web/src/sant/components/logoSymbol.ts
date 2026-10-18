// THE LOGO SYMBOL, in one swappable place. Everything that shows the logo (Logo, the nav, the dust
// power-on) draws these paths, so replacing the symbol means editing only this file.
//
// PLACEHOLDER until the user's drawing is ready. It follows the logo brief's direction A, "one point
// bursting into copies" (docs/design/logo-brief.md §3): one larger original and three equal copies
// stepping away from it in one direction, never radially.
//
// To swap in the real symbol: set `viewBox` to the SVG's viewBox and `units` to its path data, one
// entry per part, in the order the parts should light (S → A → N → T). Any number of parts works;
// a one-part symbol simply lights at once.

export type LogoSymbol = {
  /** The SVG viewBox, "minX minY width height". */
  viewBox: string;
  /** Path data per part, in lighting order. Part 0 is the original; it takes the accent. */
  units: readonly string[];
};

/** A rounded square as path data. */
function square(x: number, y: number, s: number, r: number): string {
  return (
    `M${x + r} ${y}H${x + s - r}A${r} ${r} 0 0 1 ${x + s} ${y + r}V${y + s - r}A${r} ${r} 0 0 1 ${x + s - r} ${y + s}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + s - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

export const LOGO_SYMBOL: LogoSymbol = {
  viewBox: "0 0 32 32",
  units: [square(1, 12, 15, 3.5), square(18, 12, 6, 1.5), square(25, 12, 6, 1.5), square(25, 5, 6, 1.5)],
};
