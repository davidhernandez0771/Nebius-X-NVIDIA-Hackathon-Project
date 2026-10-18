import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The live cloth needs WebGL; here it is a stub that records what it was given.
const live = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("./LiveSheet", () => ({
  default: (props: { onReady?: () => void }) => {
    live.props.push(props);
    return (
      <button type="button" data-testid="live-sheet" onClick={() => props.onReady?.()}>
        first frame
      </button>
    );
  },
}));

import PinchSheet from "./PinchSheet";

let webgl = true;
beforeEach(() => {
  live.props = [];
  webgl = true;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((kind: string) => (webgl && kind.startsWith("webgl") ? ({} as RenderingContext) : null)) as never,
  );
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sheet = () => screen.getByRole("img", { name: /fabric sheet printed with SANT/ });

describe("PinchSheet", () => {
  it("with motion and WebGL: loads the live cloth, keeping the still print until its first frame", async () => {
    render(<PinchSheet />);
    expect(sheet()).toHaveAttribute("data-mode", "live");
    expect(sheet()).toHaveAccessibleName(/Drag it to pinch the cloth/);
    const still = () => sheet().querySelector('[data-part="still-sheet"] svg');
    expect(still()).not.toBeNull(); // while the 3D code loads
    const liveSheet = await screen.findByTestId("live-sheet");
    expect(still()).not.toBeNull(); // loaded, but nothing drawn yet: no blank box
    act(() => liveSheet.click());
    expect(still()).toBeNull();
  });

  it("passes the hand input through, and null when there is none", async () => {
    const hand = { point: { x: 10, y: 20 }, pinching: true };
    const { rerender } = render(<PinchSheet hand={hand} />);
    await screen.findByTestId("live-sheet");
    expect(live.props[live.props.length - 1]).toMatchObject({ hand });
    rerender(<PinchSheet />);
    expect(live.props[live.props.length - 1]).toMatchObject({ hand: null });
  });

  it("reduced motion (prop): the still print only, no cloth and no interaction hint", () => {
    render(<PinchSheet reducedMotion />);
    expect(sheet()).toHaveAttribute("data-mode", "still");
    expect(sheet()).toHaveAccessibleName("A fabric sheet printed with SANT.");
    expect(screen.queryByTestId("live-sheet")).toBeNull();
    expect(sheet().querySelector("svg text")?.textContent).toBe("SANT");
  });

  it("follows prefers-reduced-motion when the prop is not given", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<PinchSheet />);
    expect(sheet()).toHaveAttribute("data-mode", "still");
  });

  it("the prop wins over the media query", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<PinchSheet reducedMotion={false} />);
    expect(sheet()).toHaveAttribute("data-mode", "live");
    await screen.findByTestId("live-sheet");
  });

  it("without WebGL: the still print", () => {
    webgl = false;
    render(<PinchSheet />);
    expect(sheet()).toHaveAttribute("data-mode", "still");
    expect(screen.queryByTestId("live-sheet")).toBeNull();
  });

  it("sizes to a 16:11 box by default, and takes a style override", () => {
    const { rerender } = render(<PinchSheet reducedMotion />);
    expect(sheet().style.aspectRatio).toBe("16 / 11");
    rerender(<PinchSheet reducedMotion style={{ aspectRatio: "1 / 1", maxWidth: 400 }} />);
    expect(sheet().style.aspectRatio).toBe("1 / 1");
    expect(sheet().style.maxWidth).toBe("400px");
  });
});
