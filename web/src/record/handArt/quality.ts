// Keeps the overlay cheap: it shares the GPU with MediaPipe and Isaac Sim on Record.

export interface RenderCaps {
  maxDpr: number;
  /** Most backing-store pixels the post pass may draw. */
  maxPixels: number;
}

export const DEFAULT_CAPS: RenderCaps = { maxDpr: 1.5, maxPixels: 1280 * 960 };

/** Backing-store size for a canvas of cssW x cssH. */
export function renderSize(cssW: number, cssH: number, dpr: number, caps: RenderCaps) {
  if (cssW <= 0 || cssH <= 0) return { width: 1, height: 1, pixelRatio: 1 };
  let pixelRatio = Math.min(dpr, caps.maxDpr);
  const pixels = cssW * cssH * pixelRatio * pixelRatio;
  if (pixels > caps.maxPixels) pixelRatio *= Math.sqrt(caps.maxPixels / pixels);
  return {
    width: Math.max(1, Math.floor(cssW * pixelRatio)),
    height: Math.max(1, Math.floor(cssH * pixelRatio)),
    pixelRatio,
  };
}

/** The offscreen skeleton target: a fraction of the render size. The styles sample it coarsely. */
export function fieldSize(width: number, height: number, o: { scale: number; maxWidth: number }) {
  const w = Math.min(width * o.scale, o.maxWidth);
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round((w * height) / width)) };
}

/** Rolling frame-time statistics. */
export class FrameMeter {
  private samples: number[] = [];

  constructor(private readonly size = 120) {}

  add(ms: number) {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }

  stats() {
    const n = this.samples.length;
    if (!n) return { meanMs: 0, p95Ms: 0, count: 0 };
    const sorted = [...this.samples].sort((x, y) => x - y);
    return {
      meanMs: this.samples.reduce((x, y) => x + y, 0) / n,
      p95Ms: sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)],
      count: n,
    };
  }
}
