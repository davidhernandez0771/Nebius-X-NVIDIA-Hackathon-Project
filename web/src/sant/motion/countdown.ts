// Dot-matrix digits for DottedCountdown.tsx: each digit is drawn on the same 5 × 7 grid of dots, so
// the change from 3 to 2 is dots switching on and off rather than one glyph replacing another.

export const DOT_COLS = 5;
export const DOT_ROWS = 7;

const DIGITS: Record<string, string[]> = {
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
};

/** The 35 dots of a digit, row by row: true where the dot is lit. */
export function digitDots(digit: string): boolean[] {
  return (DIGITS[digit] ?? DIGITS["0"]).join("").split("").map((c) => c === "#");
}

export function countdownSteps(from: number): number[] {
  return Array.from({ length: from }, (_, i) => from - i);
}
