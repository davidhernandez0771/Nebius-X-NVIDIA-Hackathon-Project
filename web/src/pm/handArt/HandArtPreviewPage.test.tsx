// The preview route: the six styles, the event sequence, clip controls, measuring and
// loading a recorded clip.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HandArtOverlayProps, HandArtStats } from "./HandArtOverlay";

const seen = vi.hoisted(() => ({ props: null as HandArtOverlayProps | null }));

vi.mock("./HandArtOverlay", () => ({
  default: (p: HandArtOverlayProps) => {
    seen.props = p;
    return <canvas data-testid="overlay" />;
  },
  useSystemReducedMotion: () => false,
}));

import HandArtPreviewPage from "./HandArtPreviewPage";
import { syntheticClip } from "./clip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fileWith = (text: string, name = "clip.json") => {
  const f = new File([text], name, { type: "application/json" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
  return f;
};

const NAMES = ["Ink strokes", "Ink bloom", "Particle burst", "Particle trail", "Dot ripple", "Glitch"];

describe("HandArtPreviewPage", () => {
  it("follows the clip's events by default, with each of the six styles on offer", () => {
    render(<HandArtPreviewPage />);
    expect(screen.getByRole("heading", { name: "Hand art" })).toBeTruthy();
    expect(seen.props!.style).toBe("auto");
    expect(screen.getByRole("radio", { name: "Follow the events" })).toBeTruthy();
    for (const name of NAMES) expect(screen.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeTruthy();
    const frame = seen.props!.source!()!;
    expect(frame.landmarks).toHaveLength(21);
    expect(frame).toHaveProperty("recording");
    expect(frame).toHaveProperty("resets");
  });

  it("marks recording, gripper, no hand and reset on the clip timeline", () => {
    const { container } = render(<HandArtPreviewPage />);
    for (const kind of ["recording", "closed", "lost"]) expect(container.querySelector(`.ha-span-${kind}`)).toBeTruthy();
    expect(container.querySelector(".ha-reset")).toBeTruthy();
  });

  it("pins a picked style, switches reduced motion and the busy background", () => {
    const { container } = render(<HandArtPreviewPage />);
    fireEvent.click(screen.getByRole("radio", { name: /^Dot ripple/ }));
    expect(seen.props!.style).toBe("ripple");
    fireEvent.click(screen.getByRole("checkbox", { name: "Reduce motion" }));
    expect(seen.props!.reducedMotion).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Busy background" }));
    expect(container.querySelector(".ha-stage-busy")).toBeTruthy();
  });

  it("holds the gripper closed on request", () => {
    render(<HandArtPreviewPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Hold gripper closed" }));
    expect(seen.props!.source!()!.gripperClosed).toBe(true);
  });

  it("measures each style in turn and tabulates the frame times", () => {
    vi.useFakeTimers();
    render(<HandArtPreviewPage />);
    const stats = (gpu: number): HandArtStats => ({
      fps: 60,
      cpuMeanMs: 0.5,
      cpuP95Ms: 0.7,
      gpuMeanMs: gpu,
      gpuP95Ms: gpu * 2,
      width: 640,
      height: 480,
      styleA: "ink",
      styleB: "ink",
      morphing: false,
      target: "ink",
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure each style" }));
    for (let i = 0; i < 6; i++) {
      expect(seen.props!.statsKey).toBe(seen.props!.style); // fresh statistics per style
      act(() => seen.props!.onStats!(stats(i + 1)));
      act(() => vi.advanceTimersByTime(3500));
    }
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[0].textContent).toContain("Ink strokes");
    expect(rows[5].textContent).toContain("6.00 ms");
    expect(screen.getByRole("button", { name: "Measure each style" })).toBeTruthy();
  });

  it("loads a recorded clip, and explains a file that isn't one", async () => {
    render(<HandArtPreviewPage />);
    const input = screen.getByLabelText("Load a recorded clip") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [fileWith("{}", "notes.json")] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/notes\.json isn't a hand clip/));

    const recorded = { ...syntheticClip(), source: "webcam" };
    fireEvent.change(input, { target: { files: [fileWith(JSON.stringify(recorded))] } });
    await waitFor(() => expect(screen.getByText(/Recorded clip \(webcam\)/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the synthetic hand" }));
    expect(screen.getByText(/A synthetic hand/)).toBeTruthy();
  });
});
