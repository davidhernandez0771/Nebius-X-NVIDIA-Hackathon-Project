// Quality for the world canvas. A quick GPU check on load (gpu.ts) picks one of three tiers, or the
// pre-rendered stills when there is no usable GPU. The canvas always renders on demand (a frame only
// when the scroll, a tween or an idle loop asks), and the tier caps the pixel ratio and turns the
// expensive extras on or off. Pure, so the choice is tested without a browser.
import type { GpuClass } from "./gpu";

export type TierName = "low" | "high" | "ultra";

export interface QualityTier {
  name: TierName;
  /** [min, max] device pixel ratio for the canvas. */
  dpr: [number, number];
  antialias: boolean;
  /** Real-time shadow maps. Off everywhere: the room's light and shadow are baked. */
  shadows: boolean;
  /** Whether modules may run idle loops (useWorldAnimating) when nothing scrolls. Never on low. */
  idleMotion: boolean;
  /** Clearcoat plastic on the live cartridges (MeshPhysicalMaterial) instead of the standard one. */
  physical: boolean;
  /** A small prefiltered environment for reflections on the live parts. */
  envMap: boolean;
  /** Light shafts under the lamps and a denser fog. */
  haze: boolean;
  /** Dust drifting in the light. An idle loop. */
  dust: boolean;
  powerPreference: "low-power" | "default" | "high-performance";
}

export const TIERS: Record<TierName, QualityTier> = {
  low: { name: "low", dpr: [0.75, 1], antialias: false, shadows: false, idleMotion: false, physical: false, envMap: false, haze: false, dust: false, powerPreference: "low-power" },
  high: { name: "high", dpr: [1, 1.5], antialias: true, shadows: false, idleMotion: true, physical: false, envMap: true, haze: false, dust: false, powerPreference: "default" },
  ultra: { name: "ultra", dpr: [1, 2], antialias: true, shadows: false, idleMotion: true, physical: true, envMap: true, haze: true, dust: true, powerPreference: "high-performance" },
};

/** "3d": the canvas at a tier. "stills": no canvas, one pre-rendered still per station. */
export type WorldMode = "3d" | "stills";

export interface QualityChoice {
  mode: WorldMode;
  tier: QualityTier;
}

export interface DeviceSignals {
  /** `?quality=low|high|ultra|stills` wins over everything ("medium" is an old name for high). */
  query?: string | null;
  /** `?static` forces the stills. */
  forceStatic?: boolean;
  /** What the GPU check found (gpu.ts). */
  gpu: GpuClass;
  deviceMemory?: number;
  cores?: number;
  saveData?: boolean;
  mobile?: boolean;
}

const ORDER: TierName[] = ["low", "high", "ultra"];
const lower = (a: TierName, b: TierName): TierName => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

export function pickQuality(s: DeviceSignals): QualityChoice {
  const asked = s.query?.toLowerCase();
  if (s.forceStatic || asked === "stills" || asked === "static") return { mode: "stills", tier: TIERS.low };
  if (asked === "low" || asked === "high" || asked === "ultra") return { mode: "3d", tier: TIERS[asked] };
  if (asked === "medium") return { mode: "3d", tier: TIERS.high };
  if (s.gpu === "stills") return { mode: "stills", tier: TIERS.low };

  let name: TierName = s.gpu;
  // The GPU can draw it, but a phone, data saver or a very small machine still gets the light tier.
  const weak = s.saveData === true || (s.deviceMemory !== undefined && s.deviceMemory <= 2) || (s.cores !== undefined && s.cores <= 2);
  if (weak || s.mobile) name = "low";
  // Ultra wants headroom on the CPU side too (the dust and the extra draws).
  else if (name === "ultra" && ((s.deviceMemory !== undefined && s.deviceMemory < 8) || (s.cores !== undefined && s.cores < 8))) name = lower(name, "high");
  return { mode: "3d", tier: TIERS[name] };
}

/** The browser's signals (navigator.deviceMemory is Chromium-only; absent means unknown). */
export function readSignals(search: string, gpu: GpuClass): DeviceSignals {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const q = new URLSearchParams(search);
  return {
    query: q.get("quality"),
    forceStatic: q.has("static"),
    gpu,
    deviceMemory: n.deviceMemory,
    cores: n.hardwareConcurrency,
    saveData: n.connection?.saveData,
    mobile: typeof matchMedia === "function" && matchMedia("(max-width: 820px)").matches,
  };
}
