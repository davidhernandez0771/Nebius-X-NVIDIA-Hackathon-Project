import { describe, expect, it } from "vitest";
import { EFFECTS_KEY, readEffects, resolveMotion, writeEffects } from "./effects";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("resolveMotion", () => {
  it("is full motion when the OS allows it and effects are on", () => {
    expect(resolveMotion({ prefersReduced: false, effects: "on" })).toEqual({ reduced: false });
  });

  it("is reduced when the OS asks, even with effects on", () => {
    expect(resolveMotion({ prefersReduced: true, effects: "on" })).toEqual({ reduced: true });
  });

  it("is reduced when the user turns effects off", () => {
    expect(resolveMotion({ prefersReduced: false, effects: "off" })).toEqual({ reduced: true });
  });
});

describe("readEffects / writeEffects", () => {
  it("defaults to on when nothing is stored", () => {
    expect(readEffects(memoryStorage())).toBe("on");
  });

  it("reads a stored off", () => {
    expect(readEffects(memoryStorage({ [EFFECTS_KEY]: "off" }))).toBe("off");
  });

  it("ignores a garbage value", () => {
    expect(readEffects(memoryStorage({ [EFFECTS_KEY]: "maybe" }))).toBe("on");
  });

  it("defaults to on when storage throws or is missing", () => {
    expect(readEffects(throwing)).toBe("on");
    expect(readEffects(undefined)).toBe("on");
  });

  it("writes the choice, and never throws when storage is blocked", () => {
    const s = memoryStorage();
    writeEffects(s, "off");
    expect(s.data[EFFECTS_KEY]).toBe("off");
    expect(() => writeEffects(throwing, "on")).not.toThrow();
  });
});
