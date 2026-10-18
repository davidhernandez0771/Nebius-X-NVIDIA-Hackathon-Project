// Digit positions for CountUpTiles, as on a mechanical odometer: the lowest place rolls with the
// value and a higher place turns only while the place below passes from 9 to 0. Every frame then
// shows a value between `from` and `to`, never a mix of digits nobody measured.

/** One digit tile: `place` is the power of ten, `pos` is where its 0–9 strip rests (9.5 is half way to 0). */
export type OdometerCell = { place: number; pos: number; lead: boolean };

/** The places to draw for a count from `from` to `to`, highest first, e.g. 7.5 → 42.5 at 1 decimal: [1, 0, -1]. */
export function placesFor(from: number, to: number, decimals: number): number[] {
  const whole = Math.floor(Math.max(Math.abs(from), Math.abs(to)));
  const intDigits = whole < 1 ? 1 : Math.floor(Math.log10(whole)) + 1;
  const places: number[] = [];
  for (let p = intDigits - 1; p >= -decimals; p--) places.push(p);
  return places;
}

export function odometer(value: number, places: number[]): OdometerCell[] {
  const low = Math.min(...places);
  // The value in units of the lowest place, rounded so 0.1 + 0.2 style noise can't move a digit.
  const scaled = Math.round(value * 10 ** -low * 1e6) / 1e6;
  const pos = new Map<number, number>();
  let below = 0;
  for (let p = low; p <= Math.max(...places); p++) {
    const units = scaled / 10 ** (p - low);
    const here = p === low ? units % 10 : (Math.floor(units + 1e-9) % 10) + Math.max(0, below - 9);
    pos.set(p, here);
    below = here;
  }
  return places.map((place) => ({
    place,
    pos: pos.get(place)!,
    lead: place > 0 && Math.floor(scaled / 10 ** (place - low) + 1e-9) === 0,
  }));
}
