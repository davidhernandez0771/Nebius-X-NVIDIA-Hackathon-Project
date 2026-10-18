// Geometry for Dial.tsx: the tick ring rolls under a fixed index mark, so the value always reads at
// the top. Angles are in degrees, 0 at the top, centred on the middle of the range.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const tidy = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

export function dialAngle(value: number, min: number, max: number, sweep: number): number {
  return tidy(-sweep / 2 + clamp01((value - min) / (max - min)) * sweep);
}

export type DialTick = { value: number; angle: number; major: boolean };

/** A tick on every multiple of `step` inside the range; multiples of `major` are labelled. */
export function dialTicks(min: number, max: number, step: number, major: number, sweep: number): DialTick[] {
  const ticks: DialTick[] = [];
  const first = Math.ceil(min / step - 1e-9);
  for (let i = first; i * step <= max + 1e-9; i++) {
    const value = tidy(i * step);
    ticks.push({ value, angle: dialAngle(value, min, max, sweep), major: Math.abs(value % major) < 1e-9 });
  }
  return ticks;
}
