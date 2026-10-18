import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant";
import ReviewPage2 from "./ReviewPage2";

function renderAt(url: string) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/review2" element={<ReviewPage2 />} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

describe("ReviewPage2 with the recorded example (no backend)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says it is a synthetic recorded example", async () => {
    renderAt("/review2");
    expect(await screen.findByText("Recorded example.")).toBeTruthy();
    expect(screen.getByText(/synthetic demo/)).toBeTruthy();
  });

  it("lists s1_0002's four issues with the fixes the rules applied", () => {
    renderAt("/review2");
    const list = screen.getByRole("heading", { name: "Issues and fixes" }).parentElement!;
    expect(within(list).getByText("PAUSE 2.02 s")).toBeTruthy();
    expect(within(list).getByText("PAUSE 1.60 s")).toBeTruthy();
    expect(within(list).getByText("IDLE 0.82 s")).toBeTruthy();
    expect(within(list).getByText("JITTER")).toBeTruthy();
    expect(within(list).getAllByText("remove_pause")).toHaveLength(2);
    expect(within(list).getByText("trim")).toBeTruthy();
    expect(within(list).getByText("smooth")).toBeTruthy();
  });

  it("gives the verdict from the replay, and never claims the intent check ran", () => {
    renderAt("/review2");
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(within(card).getByText("Verified ✓")).toBeTruthy();
    expect(card.textContent).toContain("Replay 9.32 s, path 1.10 m");
    expect(card.textContent).toContain("pick up the red cube and place it in the blue bin");
    expect(card.textContent).toContain("written by the rules template");
    expect(card.textContent).toContain("Not checked yet.");
    expect(card.textContent).toContain("4 issues, 4 fixes");
    expect(card.textContent).toContain("13.76 s");
  });

  it("shows the earlier Nemotron run's view of the same demo honestly", () => {
    renderAt("/review2");
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(card.textContent).toContain("nvidia/Nemotron-3.5-Super-VL (an earlier, sprint 3 run) looked at the same raw demo: no issues");
  });

  it("switches between the raw and perfected demos", () => {
    renderAt("/review2");
    const raw = screen.getByRole("button", { name: /Raw 13.76 s/ });
    const perfected = screen.getByRole("button", { name: /Perfected 9.32 s/ });
    perfected.click();
    return vi.waitFor(() => {
      expect(perfected.getAttribute("aria-pressed")).toBe("true");
      expect(raw.getAttribute("aria-pressed")).toBe("false");
    });
  });
});
