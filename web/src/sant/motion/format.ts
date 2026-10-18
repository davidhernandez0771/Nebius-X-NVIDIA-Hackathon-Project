// Numbers for Stat: a fixed number of decimals so the width never jumps while counting, and one
// locale so every machine shows the same digits.
const formatters = new Map<number, Intl.NumberFormat>();

export function formatStat(value: number, decimals: number): string {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f.format(value);
}
