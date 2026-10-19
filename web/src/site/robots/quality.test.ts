import { describe, expect, it } from "vitest";
import { floorTier, isWeakGpu, nextTier, tierSettings, TIERS } from "./quality";

describe("tierSettings", () => {
  it("renders the top tier at the device DPR, capped at 1.5, with half-resolution bloom", () => {
    expect(tierSettings(0, 2)).toEqual({ dpr: 1.5, bloom: 0.5 });
    expect(tierSettings(0, 1.25)).toEqual({ dpr: 1.25, bloom: 0.5 });
  });

  it("drops to DPR 1 and lighter bloom, then no bloom", () => {
    expect(tierSettings(1, 2)).toEqual({ dpr: 1, bloom: 0.35 });
    expect(tierSettings(2, 2).bloom).toBe(0);
    expect(tierSettings(2, 2).dpr).toBeLessThanOrEqual(1);
  });

  it("never renders above the device DPR", () => {
    expect(tierSettings(1, 0.8).dpr).toBe(0.8);
  });
});

describe("nextTier", () => {
  it("steps down one tier when fps falls and up one when it recovers", () => {
    expect(nextTier(0, "decline", 0)).toBe(1);
    expect(nextTier(1, "decline", 0)).toBe(2);
    expect(nextTier(2, "incline", 0)).toBe(1);
  });

  it("stays inside the tiers", () => {
    expect(nextTier(TIERS - 1, "decline", 0)).toBe(TIERS - 1);
    expect(nextTier(0, "incline", 0)).toBe(0);
  });

  it("never climbs above the floor (a weak GPU stays on the low tier)", () => {
    expect(nextTier(2, "incline", 2)).toBe(2);
  });
});

describe("isWeakGpu / floorTier", () => {
  it("treats software renderers as weak", () => {
    expect(isWeakGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isWeakGpu("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isWeakGpu("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe(true);
  });

  it("treats a real GPU as fine", () => {
    expect(isWeakGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isWeakGpu("")).toBe(false);
  });

  it("starts weak GPUs on the low tier and keeps them there", () => {
    expect(floorTier("SwiftShader")).toBe(TIERS - 1);
    expect(floorTier("NVIDIA GeForce")).toBe(0);
  });
});
