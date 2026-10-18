import { describe, expect, it } from "vitest";
import { TIERS, pickTier } from "./quality";

describe("pickTier", () => {
  it("lets ?quality= win", () => {
    expect(pickTier({ query: "low", deviceMemory: 16, cores: 16 }).name).toBe("low");
    expect(pickTier({ query: "HIGH", saveData: true }).name).toBe("high");
    expect(pickTier({ query: "ultra", deviceMemory: 8, cores: 8 }).name).toBe("high");
  });
  it("drops to low on weak devices, phones and data saver", () => {
    expect(pickTier({ deviceMemory: 4, cores: 8 }).name).toBe("low");
    expect(pickTier({ deviceMemory: 8, cores: 4 }).name).toBe("low");
    expect(pickTier({ saveData: true }).name).toBe("low");
    expect(pickTier({ mobile: true, deviceMemory: 8, cores: 8 }).name).toBe("low");
  });
  it("is high only when the device says it is strong, else medium", () => {
    expect(pickTier({ deviceMemory: 8, cores: 12 }).name).toBe("high");
    expect(pickTier({ cores: 12 }).name).toBe("medium");
    expect(pickTier({}).name).toBe("medium");
  });
});

describe("TIERS", () => {
  it("caps the pixel ratio and keeps idle loops off below high", () => {
    expect(TIERS.low.dpr[1]).toBe(1);
    expect(TIERS.medium.dpr[1]).toBe(1.5);
    expect(TIERS.high.dpr[1]).toBe(2);
    expect(TIERS.low.idleMotion).toBe(false);
    expect(TIERS.medium.idleMotion).toBe(false);
    expect(TIERS.low.antialias).toBe(false);
  });
});
