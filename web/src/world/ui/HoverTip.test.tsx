import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WorldContext, type WorldApi } from "../core/WorldContext";
import { HoverTip } from "./HoverTip";

vi.mock("../scene/Helix", () => ({ instanceLabel: (k: number) => `cartridge ${k}` }));

function tipAt(x: number, y: number): string {
  const { container } = render(
    <WorldContext.Provider value={{ reduced: true } as unknown as WorldApi}>
      <HoverTip />
    </WorldContext.Provider>,
  );
  const tip = container.querySelector<HTMLElement>(".world-tip")!;
  Object.defineProperty(tip, "offsetWidth", { value: 180 });
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
  return tip.style.transform;
}

describe("the cartridge tip", () => {
  afterEach(cleanup);

  it("sits right of the cursor", () => {
    expect(tipAt(100, 50)).toBe("translate(116px, 64px)");
  });

  it("flips left of the cursor near the right edge, instead of running off the screen", () => {
    expect(tipAt(window.innerWidth - 40, 50)).toBe(`translate(${window.innerWidth - 40 - 16 - 180}px, 64px)`);
  });
});
