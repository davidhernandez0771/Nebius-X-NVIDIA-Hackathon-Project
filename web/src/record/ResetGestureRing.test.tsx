import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import ResetGestureRing, { VICTORY_GLYPH } from "./ResetGestureRing";
import type { ResetGestureStatus } from "./teleop/resetGesture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const st = (over: Partial<ResetGestureStatus>): ResetGestureStatus => ({
  timestamp: 0,
  phase: "idle",
  progress: 0,
  event: null,
  ...over,
});

const bar = () => screen.getByRole("progressbar", { name: "Reset gesture" });
const arc = (c: HTMLElement) => c.querySelector('[data-part="arc"]') as SVGCircleElement;
const dashOffset = (c: HTMLElement) => Number(arc(c).getAttribute("stroke-dashoffset"));
const dashLength = (c: HTMLElement) => Number(arc(c).getAttribute("stroke-dasharray"));

describe("ResetGestureRing", () => {
  it("idle: an empty ring and a plain hint that says what to do", () => {
    const { container } = render(<ResetGestureRing status={st({})} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText(`Hold ${VICTORY_GLYPH} for 1.5 s to reset the scene`)).toBeInTheDocument();
    expect(dashOffset(container)).toBeCloseTo(dashLength(container));
  });

  it("idle with no status (no hand yet) renders the same hint", () => {
    render(<ResetGestureRing status={null} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText(/to reset the scene/)).toBeInTheDocument();
  });

  it("holding: the arc fills with progress and the label says to keep holding", () => {
    const { container } = render(<ResetGestureRing status={st({ phase: "holding", progress: 0.4 })} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("Keep holding to reset")).toBeInTheDocument();
    expect(dashOffset(container)).toBeCloseTo(dashLength(container) * 0.6);
    expect(arc(container).getAttribute("stroke")).toBe("var(--warm)");
  });

  it("clamps progress into 0..1", () => {
    const { rerender } = render(<ResetGestureRing status={st({ phase: "holding", progress: 1.7 })} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
    rerender(<ResetGestureRing status={st({ phase: "holding", progress: -2 })} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
  });

  it("fire and cooldown: a full ring in the accent color, 'Reset sent'", () => {
    const { container, rerender } = render(
      <ResetGestureRing status={st({ phase: "cooldown", progress: 1, event: "fire" })} reducedMotion />,
    );
    expect(screen.getByText("Reset sent")).toBeInTheDocument();
    expect(arc(container).getAttribute("stroke")).toBe("var(--accent)");
    expect(dashOffset(container)).toBeCloseTo(0);
    expect(bar()).toHaveAttribute("aria-valuenow", "100");

    // the detector reports progress 0 during cooldown; the ring stays full until it ends
    rerender(<ResetGestureRing status={st({ phase: "cooldown", progress: 0 })} reducedMotion />);
    expect(screen.getByText("Reset sent")).toBeInTheDocument();
    expect(dashOffset(container)).toBeCloseTo(0);
  });

  it("a cancel says why, in plain words, until the next hold starts", () => {
    const reasons = {
      gripper: "Reset cancelled: hand closed",
      moved: "Reset cancelled: hand moved",
      dropped: "Reset cancelled: sign lost",
      "low-score": "Reset cancelled: sign unclear",
    } as const;
    for (const [reason, text] of Object.entries(reasons)) {
      const { rerender, unmount } = render(
        <ResetGestureRing status={st({ event: "cancel", cancelReason: reason as keyof typeof reasons })} reducedMotion />,
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      rerender(<ResetGestureRing status={st({ timestamp: 33 })} reducedMotion />); // a later idle frame
      expect(screen.getByText(text)).toBeInTheDocument();
      rerender(<ResetGestureRing status={st({ phase: "holding", event: "start", timestamp: 66 })} reducedMotion />);
      expect(screen.queryByText(text)).toBeNull();
      expect(screen.getByText("Keep holding to reset")).toBeInTheDocument();
      unmount();
    }
  });

  it("the cancel message clears after a short time back to the hint", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ResetGestureRing status={st({ event: "cancel", cancelReason: "moved" })} reducedMotion />);
    rerender(<ResetGestureRing status={st({ timestamp: 33 })} reducedMotion />);
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText("Reset cancelled: hand moved")).toBeNull();
    expect(screen.getByText(/to reset the scene/)).toBeInTheDocument();
  });

  it("announces state changes politely, and keeps the ✌ glyph out of the accessible name", () => {
    render(<ResetGestureRing status={st({ phase: "holding", progress: 0.2 })} reducedMotion />);
    expect(screen.getByText("Keep holding to reset").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(VICTORY_GLYPH, { selector: "[aria-hidden='true'] *, [aria-hidden='true']" })).toBeInTheDocument();
  });

  it("reduced motion: no transition on the arc and no pulse on fire", () => {
    const { container } = render(<ResetGestureRing status={st({ phase: "cooldown", progress: 1, event: "fire" })} reducedMotion />);
    expect(arc(container).style.transition).toBe("");
    expect(container.querySelector('[data-part="pulse"]')).toBeNull();
  });

  it("with motion: a short transition on the arc, and one pulse when it fires", () => {
    const { container, rerender } = render(<ResetGestureRing status={st({ phase: "holding", progress: 0.5 })} reducedMotion={false} />);
    expect(arc(container).style.transition).toMatch(/stroke-dashoffset/);
    expect(container.querySelector('[data-part="pulse"]')).toBeNull();
    rerender(<ResetGestureRing status={st({ phase: "cooldown", progress: 1, event: "fire" })} reducedMotion={false} />);
    expect(container.querySelector('[data-part="pulse"]')).not.toBeNull();
  });

  it("follows prefers-reduced-motion when the prop is not given", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<ResetGestureRing status={st({ phase: "holding", progress: 0.5 })} />);
    expect(arc(container).style.transition).toBe("");
    vi.unstubAllGlobals();
  });

  it("a hint can be turned off: idle then renders nothing visible but the ring", () => {
    render(<ResetGestureRing status={st({})} showHint={false} reducedMotion />);
    expect(screen.queryByText(/to reset the scene/)).toBeNull();
    expect(bar()).toBeInTheDocument();
  });
});
