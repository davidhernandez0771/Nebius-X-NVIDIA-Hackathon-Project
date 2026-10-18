import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SantRoot } from "../../sant/SantRoot";
import { ResultsPage } from "./ResultsPage";
import { ARMS } from "./facts";

vi.mock("lenis", () => ({ default: class { destroy() {} } }));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

/** An IntersectionObserver that reports "in view" only when the test says so. */
function stubObserver() {
  const seen: (() => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() {
        seen.push(() => this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      disconnect() {}
      unobserve() {}
    },
  );
  return () => seen.forEach((f) => f());
}

function page() {
  return render(
    <MemoryRouter initialEntries={["/site/results"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<SantRoot />}>
          <Route path="/site/results" element={<ResultsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Results page", () => {
  it("leads with the confirmatory result, its CIs and p", () => {
    stubReducedMotion(true);
    page();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Multiplying 10 demos made the robot better. Tripling the copies didn't help more.",
    );
    expect(screen.getByRole("group", { name: /^17\/40 / })).toBeTruthy();
    const ledger = screen.getByRole("table", { name: /headline result/i });
    for (const ci of ["2.6–19.9%", "28.5–57.8%", "26.3–55.4%"]) expect(within(ledger).getByText(ci)).toBeTruthy();
    expect(ledger.textContent).toMatch(/p = 0\.0005/);
    expect(ledger.textContent).toMatch(/p = 0\.0012/);
  });

  it("says the source demos were scripted, next to the proof", () => {
    stubReducedMotion(true);
    page();
    const hero = screen.getByRole("region", { name: /Multiplying 10 demos/ });
    expect(hero.textContent).toMatch(/Scripted-expert source demos; human demos come next\./);
  });

  it("shows the limits beside the result, not only in a footnote", () => {
    stubReducedMotion(true);
    page();
    const limits = screen.getByRole("list", { name: /limits/i });
    expect(within(limits).getAllByRole("listitem")).toHaveLength(4);
    expect(limits.textContent).toMatch(/scripted expert/);
  });

  it("gives the copies chart all three arms, the plateau caveat and an accessible table", () => {
    stubReducedMotion(true);
    page();
    const chart = screen.getByRole("figure", { name: /same 40 new scenes/i });
    const table = within(chart).getByRole("table");
    for (const a of ARMS) {
      expect(within(table).getByText(`${a.k} of ${a.n}`)).toBeTruthy();
      expect(within(table).getByText(a.ci.text)).toBeTruthy();
    }
    expect(screen.getByText(/no detectable difference/)).toBeTruthy();
    expect(screen.getByText(/about 1\.6 times/)).toBeTruthy();
  });

  it("cites a source for every figure and card", () => {
    stubReducedMotion(true);
    const { container } = page();
    const cited = container.querySelectorAll("figure, .sant-report:not(.sant-report--pending), .sant-margin-note, .sant-results__limits li");
    expect(cited.length).toBeGreaterThan(8);
    for (const el of cited) expect(el.textContent).toMatch(/note, lines? \d/);
  });

  it("with motion reduced, shows the finished run and no replay button", () => {
    stubReducedMotion(true);
    page();
    expect(screen.getByTestId("replay-progress").textContent).toBe("40 of 40 scenes");
    expect(screen.queryByRole("button", { name: /replay/i })).toBeNull();
  });

  it("draws the chart scene by scene once it is seen, and can replay", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const show = stubObserver();
    page();
    expect(screen.getByTestId("replay-progress").textContent).toBe("0 of 40 scenes");
    act(() => show());
    act(() => vi.advanceTimersByTime(600));
    const mid = Number(screen.getByTestId("replay-progress").textContent!.split(" ")[0]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(40);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("replay-progress").textContent).toBe("40 of 40 scenes");

    fireEvent.click(screen.getByRole("button", { name: "Replay the runs" }));
    expect(screen.getByTestId("replay-progress").textContent).toBe("0 of 40 scenes");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("replay-progress").textContent).toBe("40 of 40 scenes");
  });

  it("fills the report-card template, and says pending where nothing is measured", () => {
    stubReducedMotion(true);
    page();
    const franka = screen.getByRole("region", { name: "Franka Panda" });
    expect(franka.textContent).toMatch(/22 of 23/);
    expect(franka.textContent).toMatch(/23 of 24/);
    expect(franka.textContent).toMatch(/27\/30/);
    expect(within(franka).getAllByText("Pending")).toHaveLength(1);
    expect(franka.textContent).toMatch(/No reach map measured yet/);
    const openarm = screen.getByRole("region", { name: "OpenArm" });
    expect(openarm.textContent).toMatch(/0\/30/);
    expect(openarm.textContent).toMatch(/Design flaw found/);
    expect(openarm.textContent).toMatch(/±45° wrist/);
    expect(screen.getByRole("region", { name: "Flexiv Rizon 4s" }).textContent).toMatch(/9\/30/);
    const yours = screen.getByRole("region", { name: "Your robot" });
    expect(within(yours).getAllByText("Pending")).toHaveLength(4);
  });
});
