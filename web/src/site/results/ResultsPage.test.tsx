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
    const copies = screen.getByRole("region", { name: /Did 300 copies beat 100/ });
    expect(within(copies).getByText(/no detectable difference/)).toBeTruthy();
    expect(within(copies).getByText(/about 1\.6 times/)).toBeTruthy();
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
    expect(franka.textContent).toMatch(/30\/30/);
    expect(franka.textContent).toMatch(/27\/30 in the first run/);
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

  it("shows no sample data, and says where the numbers come from", () => {
    stubReducedMotion(true);
    const { container } = page();
    expect(container.textContent).not.toMatch(/sample/i);
    expect(screen.getByRole("region", { name: "Where the numbers come from" }).textContent).toMatch(/web\/src\/site\/results\/results\.json/);
  });

  it("shows the grasp fix as no detectable difference, with its seeds and pre-registered test", () => {
    stubReducedMotion(true);
    page();
    const s = screen.getByRole("region", { name: "Does a centered approach stop the drops?" });
    expect(within(s).getByTestId("arm-centered_10x10").textContent).toMatch(/20\/40.*50%.*35\.2–64\.8%/);
    expect(within(s).getByTestId("comparison").textContent).toBe("20/40 vs 17/40: p = 0.65, no detectable difference");
    expect(s.textContent).toMatch(/5020–5059/);
    expect(s.textContent).toMatch(/Pre-registered two-sided Fisher exact/);
  });

  it("shows Nemotron against the code baseline as labeler and judge", () => {
    stubReducedMotion(true);
    page();
    const s = screen.getByRole("region", { name: "Can Nemotron label and judge demos?" });
    const at = (key: string) => within(within(s).getByTestId(`arm-${key}`)).getAllByRole("cell")[0].textContent;
    expect(["labeler_nemotron", "labeler_code", "judge_nemotron", "judge_code"].map(at)).toEqual(["40/40", "39/40", "59/60", "60/60"]);
    expect(within(s).getAllByTestId("comparison").map((c) => c.textContent)).toEqual([
      "40/40 vs 39/40: p = 1.0, no detectable difference",
      "59/60 vs 60/60: p = 1.0, no detectable difference",
    ]);
    expect(s.textContent).toMatch(/sign test \(McNemar\)/);
  });

  it("shows the bring-your-own-robot runs on seeds 100–129", () => {
    stubReducedMotion(true);
    page();
    const s = screen.getByRole("region", { name: "Does the pipeline work on another robot?" });
    expect(within(s).getByTestId("arm-franka").textContent).toMatch(/30\/30/);
    expect(within(s).getByTestId("arm-openarm").textContent).toMatch(/0\/30/);
    expect(s.textContent).toMatch(/100–129/);
  });

  it("marks what hasn't run as pending, never 0%", () => {
    stubReducedMotion(true);
    page();
    const pending = screen.getByRole("region", { name: "Not measured yet" });
    const human = within(pending).getByRole("region", { name: "Does perfecting human demos before multiplying help more?" });
    expect(within(human).getAllByText("Pending").length).toBeGreaterThanOrEqual(3);
    expect(within(human).getByTestId("arm-perfected_multiply").textContent).not.toMatch(/\d%/);
    expect(within(human).getByTestId("comparison").textContent).toMatch(/: pending$/);
    const run2 = within(pending).getByRole("region", { name: "Grasp fix, run 2: recovery copies and longer training" });
    expect(within(run2).getByTestId("arm-recovery_60k").textContent).toMatch(/Pending/);
    expect(within(run2).getByTestId("arm-centered_10x10").textContent).toMatch(/20\/40/);
    expect(within(run2).getByTestId("comparison").textContent).toBe("+ recovery copies, 60k vs 20/40: pending");
  });
});
