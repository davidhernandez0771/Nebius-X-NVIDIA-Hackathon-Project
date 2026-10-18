// Quality tiers for the shelf. The page starts on the top tier and steps down when fps falls (drei's
// PerformanceMonitor decides), which also shrinks its GPU memory: when Isaac or training shares the GPU, a big
// footprint is what makes the page page out and freeze. Weak (software) GPUs start, and stay, on the low tier.

export const TIERS = 3;
const SETTINGS = [
  { dpr: 1.5, bloom: 0.5 }, // top: DPR up to 1.5, bloom at half resolution
  { dpr: 1, bloom: 0.35 }, // DPR 1, lighter bloom chain
  { dpr: 0.85, bloom: 0 }, // low: slightly under DPR 1, no bloom
];

/** Render DPR and bloom resolution scale (0 = off) for a tier on a device with DPR deviceDpr. */
export function tierSettings(tier: number, deviceDpr: number): { dpr: number; bloom: number } {
  const s = SETTINGS[Math.max(0, Math.min(TIERS - 1, tier))];
  return { dpr: Math.min(s.dpr, deviceDpr), bloom: s.bloom };
}

export function nextTier(tier: number, event: "incline" | "decline", floor: number): number {
  const t = event === "decline" ? tier + 1 : tier - 1;
  return Math.max(floor, Math.min(TIERS - 1, t));
}

export function isWeakGpu(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

/** The best tier a GPU may use. */
export function floorTier(renderer: string): number {
  return isWeakGpu(renderer) ? TIERS - 1 : 0;
}
