import { describe, expect, it } from "vitest";
import { cablePath, isClick } from "./wiring";

describe("cablePath", () => {
  it("leaves the socket downwards and enters the port from the right", () => {
    expect(cablePath({ x: 100, y: 20 }, { x: 300, y: 220 })).toBe("M 100 20 C 100 120, 380 220, 300 220");
  });

  it("keeps a visible bend for a short hop", () => {
    expect(cablePath({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe("M 0 0 C 0 40, 50 10, 10 10");
  });
});

describe("isClick", () => {
  it("treats a press that barely moved as a click", () => {
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: -2 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(false);
  });
});
