// The preview route: style picker, clip controls and loading a recorded clip.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HandArtOverlayProps } from "./HandArtOverlay";

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

afterEach(cleanup);

const fileWith = (text: string, name = "clip.json") => {
  const f = new File([text], name, { type: "application/json" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
  return f;
};

describe("HandArtPreviewPage", () => {
  it("plays the synthetic clip in auto style with every style on offer", () => {
    render(<HandArtPreviewPage />);
    expect(screen.getByRole("heading", { name: "Hand art" })).toBeTruthy();
    expect(seen.props!.style).toBe("auto");
    for (const name of ["Auto", "Text marks", "Dither", "Halftone", "Particles", "Glow lines"])
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    const frame = seen.props!.source!()!;
    expect(frame.landmarks).toHaveLength(21);
  });

  it("pins the picked style and switches reduced motion", () => {
    render(<HandArtPreviewPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Halftone" }));
    expect(seen.props!.style).toBe("halftone");
    fireEvent.click(screen.getByRole("checkbox", { name: "Reduce motion" }));
    expect(seen.props!.reducedMotion).toBe(true);
  });

  it("holds the gripper closed on request", () => {
    render(<HandArtPreviewPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Hold gripper closed" }));
    expect(seen.props!.source!()!.gripperClosed).toBe(true);
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
