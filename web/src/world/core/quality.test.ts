import { describe, expect, it } from "vitest";
import { TIERS, pickQuality } from "./quality";

const pick = (s: Partial<Parameters<typeof pickQuality>[0]>) => {
  const q = pickQuality({ gpu: "high", ...s });
  return q.mode === "stills" ? "stills" : q.tier.name;
};

describe("pickQuality", () => {
  it("lets ?quality= and ?static win", () => {
    expect(pick({ query: "low", gpu: "ultra" })).toBe("low");
    expect(pick({ query: "ULTRA", gpu: "low", saveData: true })).toBe("ultra");
    expect(pick({ query: "medium" })).toBe("high");
    expect(pick({ query: "stills", gpu: "ultra" })).toBe("stills");
    expect(pick({ forceStatic: true, gpu: "ultra" })).toBe("stills");
    expect(pick({ query: "nonsense", gpu: "low" })).toBe("low");
  });

  it("follows the GPU check", () => {
    expect(pick({ gpu: "ultra", deviceMemory: 16, cores: 16 })).toBe("ultra");
    expect(pick({ gpu: "high" })).toBe("high");
    expect(pick({ gpu: "low" })).toBe("low");
    expect(pick({ gpu: "stills" })).toBe("stills");
  });

  it("keeps phones, data saver and tiny machines on low, and ultra off small CPUs", () => {
    expect(pick({ gpu: "ultra", mobile: true })).toBe("low");
    expect(pick({ gpu: "ultra", saveData: true })).toBe("low");
    expect(pick({ gpu: "high", cores: 2 })).toBe("low");
    expect(pick({ gpu: "ultra", cores: 4, deviceMemory: 16 })).toBe("high");
    expect(pick({ gpu: "ultra", deviceMemory: 4, cores: 16 })).toBe("high");
  });
});

describe("TIERS", () => {
  it("caps the pixel ratio, keeps low still, and saves haze and dust for ultra", () => {
    expect(TIERS.low.dpr[1]).toBe(1);
    expect(TIERS.high.dpr[1]).toBe(1.5);
    expect(TIERS.ultra.dpr[1]).toBe(2);
    expect(TIERS.low.idleMotion).toBe(false);
    expect(TIERS.low.antialias).toBe(false);
    expect([TIERS.low.haze, TIERS.high.haze, TIERS.ultra.haze]).toEqual([false, false, true]);
    expect([TIERS.low.dust, TIERS.high.dust, TIERS.ultra.dust]).toEqual([false, false, true]);
    expect(Object.values(TIERS).every((t) => !t.shadows)).toBe(true);
  });
});
