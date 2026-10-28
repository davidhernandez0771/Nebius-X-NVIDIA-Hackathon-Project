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
  // site-nav (2026-10-26, the user): lead with the proof, the newest pre-registered one-shot result.
  it("leads with the proof: 10 human mouse demos to 30/40, pre-registered and run once, with its CI, goal and source", () => {
    stubReducedMotion(true);
    page();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Results");
    const lead = screen.getByRole("region", { name: "10 human mouse demos → 30/40 (75%) on unseen scenes" });
    expect(lead.id).toBe("proof");
    expect(lead.textContent).toMatch(/Pre-registered/);
    expect(lead.textContent).toMatch(/run once/);
    expect(lead.textContent).toMatch(/59\.8–85\.8%/);
    expect(lead.textContent).toMatch(/at least 24\/40/);
    expect(lead.textContent).toMatch(/5400–5439/);
    expect(lead.textContent).toMatch(/note, lines? \d/);
    // The proof band follows it, then the earlier experiments.
    const order = [...document.querySelectorAll("#proof, .sant-proof, #results-earlier")];
    expect(order.map((e) => e.id || e.className.split(" ")[1])).toEqual(["proof", "sant-proof", "results-earlier"]);
  });

  // 2026-10-28 (the user): the page is in the work pages' dark frame, and easy to move on from.
  it("is a work page: the holo frame, Results marked in its nav, no Robots link, and the way on to the runs and Record", () => {
    stubReducedMotion(true);
    const { container } = page();
    expect(container.querySelector(".holo-page")?.getAttribute("data-here")).toBe("results");
    const more = screen.getByRole("navigation", { name: "More" });
    expect(within(more).getByRole("link", { name: "Results" }).getAttribute("aria-current")).toBe("page");
    expect(within(more).queryByRole("link", { name: "Robots" })).toBeNull();
    expect(container.querySelector('a[href="/robots"]')).toBeNull();
    const next = screen.getByRole("navigation", { name: "See it run" });
    expect(within(next).getByRole("link", { name: /40 test runs/ }).getAttribute("href")).toBe("/test-track");
    expect(within(next).getByRole("link", { name: /Record a demo/ }).getAttribute("href")).toBe("/record");
  });

  // 2026-10-28 (the user): nothing the project doesn't have. No pending runs, no previews, no stale wording.
  it("shows only finished results: no pending runs, no report-card previews, no other-robot upload", () => {
    stubReducedMotion(true);
    const { container } = page();
    const text = container.textContent!;
    expect(text).not.toMatch(/Pending/);
    expect(text).not.toMatch(/Not measured yet/);
    expect(text).not.toMatch(/Your robot/);
    expect(text).not.toMatch(/tonight/i);
    expect(text).not.toMatch(/being traced/);
    expect(text).not.toMatch(/sample/i);
  });

  it("keeps the earlier scripted result in the earlier experiments, its CIs and p", () => {
    stubReducedMotion(true);
    page();
    const earlier = screen.getByRole("region", { name: "Before the proof: the earlier experiments" });
    const s = within(earlier).getByRole("region", { name: /Multiplying 10 demos made the robot better/ });
    const ledger = within(s).getByRole("table", { name: /multiply result/i });
    for (const a of ARMS) expect(within(ledger).getByText(a.ci.text)).toBeTruthy();
    expect(ledger.textContent).toMatch(/p = 0\.0005/);
    expect(ledger.textContent).toMatch(/p = 0\.0012/);
    expect(s.textContent).toMatch(/scripted expert/);
  });

  it("states what it doesn't show", () => {
    stubReducedMotion(true);
    page();
    const limits = screen.getByRole("list", { name: /limits/i });
    expect(within(limits).getAllByRole("listitem")).toHaveLength(4);
    expect(limits.textContent).toMatch(/simulation/);
    expect(limits.textContent).toMatch(/One training run per recipe/);
  });

  it("cites a source for every figure and margin note", () => {
    stubReducedMotion(true);
    const { container } = page();
    const cited = container.querySelectorAll("figure, .sant-margin-note");
    expect(cited.length).toBeGreaterThan(6);
    for (const el of cited) expect(el.textContent).toMatch(/note, lines? \d/);
  });

  it("says where the numbers come from", () => {
    stubReducedMotion(true);
    page();
    const s = screen.getByRole("region", { name: "Where the numbers come from" });
    expect(s.textContent).toMatch(/web\/src\/site\/results\/proofData\.ts/);
    expect(s.textContent).toMatch(/2026-10-23-bigtest-prereg\.md/);
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

  it("shows the real webcam demos and the blind repair A/B from the stores", () => {
    stubReducedMotion(true);
    page();
    const webcam = screen.getByRole("region", { name: "Real webcam demos: checked, repaired, multiplied, trained" });
    expect(within(webcam).getByTestId("arm-webcam_raw").textContent).toMatch(/0\/10/);
    expect(within(webcam).getByTestId("arm-webcam_copies").textContent).toMatch(/24\/30/);
    expect(within(webcam).getByTestId("arm-webcam_policy").textContent).toMatch(/3\/40.*2\.6–19\.9%/);
    expect(webcam.textContent).toMatch(/one arm, not a comparison/);
    expect(webcam.textContent).toMatch(/Experiment store: human_exp\/human10c\/results\.json/);
    const ab = screen.getByRole("region", { name: "Blind repair A/B: Nemotron's edits vs the hand-written rules" });
    expect(within(ab).getAllByTestId("comparison").map((c) => c.textContent)).toEqual([
      "3/10 vs 5/10: p = 0.5, not significant (exact McNemar, paired)",
      "3/10 vs 2/10: p = 1.0, not significant (exact McNemar, paired)",
    ]);
    expect(within(ab).getByTestId("arm-union_edits").textContent).toMatch(/6\/10/);
  });

  it("links every note it cites to its lines", () => {
    stubReducedMotion(true);
    page();
    const earlier = screen.getByRole("region", { name: "Before the proof: the earlier experiments" });
    const links = within(earlier).getAllByRole("link");
    expect(links.length).toBeGreaterThan(8);
    for (const a of links) expect(a.getAttribute("href")).toMatch(/\/docs\/superpowers\/notes\/[\w-]+\.md#L\d+(-L\d+)?$/);
  });
});

describe("The proof band: the pre-registered results as charts", () => {
  const SECTIONS = ["The climb: from 0/40 to 30/40", "Did the human demos matter? The teacher side", "Why the 10 v2 test failures failed", "What didn't work"];

  function proof() {
    return screen.getByRole("region", { name: "The proof: pre-registered, each run once" });
  }

  /** The text of the elements a node's aria-describedby points at. */
  function description(el: Element) {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  }

  it("renders the four sections, each under its heading, after the lead and before the earlier result", () => {
    stubReducedMotion(true);
    page();
    const band = proof();
    for (const name of SECTIONS) {
      const s = within(band).getByRole("region", { name });
      expect(within(s).getByRole("heading", { level: 3, name })).toBeTruthy();
    }
    // site-nav: the lead (the h1) comes first, the band next, the earlier scripted result after it.
    const lead = screen.getByRole("region", { name: /human mouse demos/ });
    expect(lead.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const earlier = screen.getByRole("region", { name: /Multiplying 10 demos/ });
    expect(band.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives each chart an accessible name, a description and a data table", () => {
    stubReducedMotion(true);
    page();
    const figures = within(proof()).getAllByRole("figure");
    expect(figures.map((f) => f.getAttribute("aria-labelledby") && document.getElementById(f.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Success on the 40-scene one-shot test",
      "Home-start success out of 128, by RL training iteration",
      "Why each of the 10 failed scenes failed",
    ]);
    for (const f of figures) {
      expect(description(f).length).toBeGreaterThan(60);
      expect(within(f).getByRole("table")).toBeTruthy();
    }
  });

  it("climbs from 0/40 to 30/40, with each CI, the 60% goal and the seed footnote", () => {
    stubReducedMotion(true);
    page();
    const s = within(proof()).getByRole("region", { name: SECTIONS[0] });
    const table = within(s).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["0/40", "3/40", "15/40", "30/40"]);
    for (const ci of ["0.0–8.8%", "2.6–19.9%", "24.2–53.0%", "59.8–85.8%"]) expect(within(table).getByText(ci)).toBeTruthy();
    expect(description(within(s).getByRole("figure"))).toMatch(/30\/40.*goal of 24\/40/);
    expect(s.textContent).toMatch(/Goal 60% \(24\/40\)/);
    expect(s.textContent).toContain(
      "Each bar is its own pre-registered test, run once. v2 was tested on fresh seeds 5400–5439; the others on 5020–5059, so the comparisons are descriptive.",
    );
  });

  it("shows the teacher with and without human demo starts, by iteration, and the final Wilson intervals", () => {
    stubReducedMotion(true);
    page();
    const s = within(proof()).getByRole("region", { name: SECTIONS[1] });
    const table = within(s).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["300 0/128 0/128", "600 10/128 0/128", "900 99/128 0/128", "1200 109/128 0/128", "1499 113/128 0/128"].map((t) => expect.stringMatching(new RegExp(`^${t.split(" ").join("\s*")}$`))));
    expect(s.textContent).toMatch(/81\.6–92\.8%/);
    expect(s.textContent).toMatch(/0\.0–2\.9%/);
    expect(s.textContent).toContain("Same code, budget and seed; one run per arm.");
  });

  it("reads out an iteration on hover or focus, ending on the last by default", () => {
    stubReducedMotion(true);
    page();
    const s = within(proof()).getByRole("region", { name: SECTIONS[1] });
    const readout = within(s).getByTestId("curve-readout");
    expect(readout.textContent).toMatch(/Iteration 1499.*113\/128.*0\/128/);
    fireEvent.focus(within(s).getByRole("button", { name: /Iteration 900/ }));
    expect(readout.textContent).toMatch(/Iteration 900.*99\/128.*0\/128/);
    fireEvent.mouseEnter(within(s).getByRole("button", { name: /Iteration 600/ }));
    expect(readout.textContent).toMatch(/Iteration 600.*10\/128/);
  });

  it("breaks down why v2's 10 failures failed, and says all 10 ran out the 30 s limit", () => {
    stubReducedMotion(true);
    page();
    const s = within(proof()).getByRole("region", { name: SECTIONS[2] });
    const table = within(s).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [within(r).getByRole("rowheader").textContent, within(r).getAllByRole("cell")[0].textContent]);
    expect(rows).toEqual([
      ["Dropped the cube", "10"],
      ["Not in the bin", "9"],
      ["Collision", "5"],
      ["Gripper closed", "2"],
    ]);
    expect(s.textContent).toMatch(/All 10 ran out the 30 s time limit/);
    expect(s.textContent).toMatch(/one failure can have several reasons/i);
  });

  it("lists what didn't work, with its numbers", () => {
    stubReducedMotion(true);
    page();
    const s = within(proof()).getByRole("region", { name: SECTIONS[3] });
    const items = within(s).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/0\/110 passed/);
    expect(items[1].textContent).toMatch(/7–8\/29.*unknown reason.*lost the pre-registered pick/);
    expect(items[2].textContent).toMatch(/1\.7 m\/s.*3\/50.*0\.5 m\/s cap fixed it \(50\/50\)/);
    for (const li of items) expect(li.textContent).toMatch(/note, lines? \d/);
  });

  it("names the two pre-registration notes among the sources", () => {
    stubReducedMotion(true);
    page();
    const sources = screen.getByRole("region", { name: "Where the numbers come from" });
    expect(sources.textContent).toMatch(/docs\/superpowers\/notes\/2026-10-23-bigtest-prereg\.md/);
    expect(sources.textContent).toMatch(/docs\/superpowers\/notes\/2026-10-21-distill-prereg\.md/);
    expect(sources.textContent).toMatch(/proofData\.ts/);
  });

  it("with motion on, the bars wait to be seen, then grow", () => {
    stubReducedMotion(false);
    const show = stubObserver();
    page();
    const plot = within(proof()).getByTestId("climb-plot");
    expect(plot.dataset.grown).toBe("false");
    act(() => show());
    expect(plot.dataset.grown).toBe("true");
  });
});
