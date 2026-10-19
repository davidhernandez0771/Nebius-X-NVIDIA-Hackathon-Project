// The loader's progress: real milestones, no timer. Each step reports 0–1 and carries a weight:
// - canvas: the 3D chunk arrived and the WebGL context is up (the intro's Scene mounted);
// - fonts: Geist Mono for the loader, the beats and the labels;
// - assets: what three's loading manager fetches for the intro (the mark image), via drei's useProgress;
// - build: the particles are made for the tier;
// - compile: renderer.compileAsync() finished every shader on screen, so the first scroll never hitches.
export const STEPS = { canvas: 0.25, fonts: 0.15, assets: 0.2, build: 0.15, compile: 0.25 } as const;
export type Step = keyof typeof STEPS;

export interface Load {
  set(step: Step, f: number): void;
  /** 0–1 overall. Never goes back. */
  value(): number;
  subscribe(fn: (v: number) => void): () => void;
  reset(): void;
}

export function createLoad(): Load {
  const parts: Record<Step, number> = { canvas: 0, fonts: 0, assets: 0, build: 0, compile: 0 };
  const fns = new Set<(v: number) => void>();
  let shown = 0;
  const value = () => shown;
  return {
    set(step, f) {
      const v = Math.min(1, Math.max(0, f));
      if (v <= parts[step]) return;
      parts[step] = v;
      const sum = (Object.keys(STEPS) as Step[]).reduce((s, k) => s + STEPS[k] * parts[k], 0);
      shown = Math.max(shown, Math.min(1, sum));
      fns.forEach((fn) => fn(shown));
    },
    value,
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    reset() {
      (Object.keys(parts) as Step[]).forEach((k) => (parts[k] = 0));
      shown = 0;
    },
  };
}

/** The page's one loader. */
export const load = createLoad();

/**
 * The loader's picture: a cassette cartridge drawn in `/` characters, two reel holes and an `=`
 * label band, as rows top to bottom (the prototype's dome).
 */
export function cartridgeRows(rows = 13, cols = 26): string[] {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let s = "";
    for (let c = 0; c < cols; c++) {
      const x = (((c + 0.5) / cols) * 2 - 1) * 7.8;
      const y = (((r + 0.5) / rows) * 2 - 1) * 7.7;
      const body = Math.abs(x) < 7.6 && Math.abs(y) < 7.5 && !(Math.abs(x) > 6.4 && Math.abs(y) > 6.2);
      const reel = Math.hypot(x + 3.1, y - 0.6) < 1.7 || Math.hypot(x - 3.1, y - 0.6) < 1.7;
      const label = y < -3.4 && y > -6.6 && Math.abs(x) < 6.2;
      s += !body ? " " : reel ? " " : label ? "=" : "/";
    }
    out.push(s);
  }
  return out;
}

/** How many rows are lit, from the bottom, at progress v. */
export const litRows = (v: number, rows: number) => Math.round(Math.min(1, Math.max(0, v)) * rows);
