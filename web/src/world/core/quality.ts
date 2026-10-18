// Quality tiers for the world canvas. The canvas always renders on demand (a frame only when the
// scroll, a tween or a module asks), so an idle world costs nothing; the tier caps the pixel ratio
// and turns the expensive extras on or off. Pure, so the choice is tested without a browser.

export type TierName = "low" | "medium" | "high";

export interface QualityTier {
  name: TierName;
  /** [min, max] device pixel ratio for the canvas. */
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  /** Whether modules may run idle loops (useWorldAnimating) when nothing scrolls. Never on low/medium. */
  idleMotion: boolean;
  powerPreference: "low-power" | "default" | "high-performance";
}

export const TIERS: Record<TierName, QualityTier> = {
  low: { name: "low", dpr: [0.75, 1], antialias: false, shadows: false, idleMotion: false, powerPreference: "low-power" },
  medium: { name: "medium", dpr: [1, 1.5], antialias: true, shadows: false, idleMotion: false, powerPreference: "default" },
  high: { name: "high", dpr: [1, 2], antialias: true, shadows: true, idleMotion: true, powerPreference: "high-performance" },
};

export interface DeviceSignals {
  /** `?quality=low|medium|high` wins over everything. */
  query?: string | null;
  deviceMemory?: number;
  cores?: number;
  saveData?: boolean;
  mobile?: boolean;
}

export function pickTier(s: DeviceSignals): QualityTier {
  const asked = s.query?.toLowerCase();
  if (asked === "low" || asked === "medium" || asked === "high") return TIERS[asked];
  const weak = s.saveData === true || (s.deviceMemory !== undefined && s.deviceMemory <= 4) || (s.cores !== undefined && s.cores <= 4);
  if (weak || s.mobile) return TIERS.low;
  if ((s.deviceMemory ?? 0) >= 8 && (s.cores ?? 0) >= 8) return TIERS.high;
  return TIERS.medium;
}

/** The browser's signals (navigator.deviceMemory is Chromium-only; absent means unknown). */
export function readSignals(search: string): DeviceSignals {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    query: new URLSearchParams(search).get("quality"),
    deviceMemory: n.deviceMemory,
    cores: n.hardwareConcurrency,
    saveData: n.connection?.saveData,
    mobile: typeof matchMedia === "function" && matchMedia("(max-width: 820px)").matches,
  };
}
