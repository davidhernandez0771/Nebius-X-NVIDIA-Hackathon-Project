// "How to use it" on /record: open on a first visit, folded by Hide or the toggle, remembered, and never a throw when
// the browser's storage refuses.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HOWTO_KEY, HOWTO_STEPS, useHowTo } from "./HowTo";

function Host() {
  const h = useHowTo();
  return (
    <>
      {h.toggle}
      {h.box}
    </>
  );
}

const box = () => screen.queryByRole("region", { name: "How to use it" });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("How to use it", () => {
  it("covers the four things to do: input, drive to the cube and into the bin, Stop, then SANT checks", () => {
    const all = HOWTO_STEPS.map((s) => `${s.lead} ${s.rest}`).join(" ");
    expect(all).toMatch(/Keyboard, Mouse or Camera/);
    expect(all).toMatch(/cube/);
    expect(all).toMatch(/bin/);
    expect(all).toMatch(/Stop/);
    expect(all).toMatch(/SANT checks/);
  });

  it("is open on a first visit, and Hide folds it and is remembered", () => {
    render(<Host />);
    expect(box()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(box()).toBeNull();
    expect(window.localStorage.getItem(HOWTO_KEY)).toBe("closed");
    cleanup();
    render(<Host />);
    expect(box()).toBeNull();
    const toggle = screen.getByRole("button", { name: /How to/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(box()).not.toBeNull();
    expect(window.localStorage.getItem(HOWTO_KEY)).toBe("open");
  });

  describe("when the storage refuses", () => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    beforeEach(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError");
        },
      });
    });
    afterEach(() => {
      if (own) Object.defineProperty(window, "localStorage", own);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    });

    it("still opens and folds", () => {
      render(<Host />);
      expect(box()).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Hide" }));
      expect(box()).toBeNull();
    });
  });
});
