// The holo primitives (/data, /pipeline): the page frame Record → Pipeline → Data share, the panel, tag, rule and
// trace, and the hand-off link that carries the visitor from one page to the next.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { HandoffLink, HoloPage, HoloPanel, HoloRule, HoloTag, HoloTrace } from "./Holo";
import { HANDOFF_IN_MS, resetHandoff } from "./handoff";

function reducedMotion(on: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

function at(url: string, ui: JSX.Element) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/record" element={ui} />
          <Route path="/pipeline" element={<HoloPage title="The pipeline" here="pipeline">pipeline page</HoloPage>} />
          <Route path="/data" element={<HoloPage title="The data" here="data">data page</HoloPage>} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
});
afterEach(() => {
  cleanup();
  resetHandoff();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the page frame", () => {
  it("has one h1 (the title), a skip link to the main content and the actions", () => {
    render(
      <MotionProvider>
        <MemoryRouter initialEntries={["/data"]}>
          <HoloPage title="The data" here="data" actions={<button type="button">Live</button>}>
            <p>inside</p>
          </HoloPage>
        </MemoryRouter>
      </MotionProvider>,
    );
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["The data"]);
    const main = screen.getByRole("main");
    expect(within(main).getByText("inside")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(`#${main.id}`);
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
  });

  it("keeps the SANT app's root (.sant, Volt) so the pages' own rules and tokens apply", () => {
    const { container } = at("/data", <></>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("sant")).toBe(true);
    expect(root.classList.contains("holo")).toBe(true);
    expect(root.dataset.mode).toBe("volt");
  });

  it("shows the path Record › Pipeline › Data, the current page marked, and the way back to the workshop", () => {
    at("/pipeline", <></>);
    const path = screen.getByRole("navigation", { name: "Pages" });
    const links = within(path).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Record", "Pipeline", "Data"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/record", "/pipeline", "/data"]);
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, "page", null]);
    // The way back (site-nav): "← Back to workshop", the first link after the mark, top left.
    const back = screen.getByRole("link", { name: "Back to workshop" });
    expect(back.getAttribute("href")).toBe("/");
    expect(document.querySelector(".holo-top a")).toBe(back);
  });
});

describe("a page off the path (the test track)", () => {
  it("is in the More nav, marked there; nothing on the path is current", () => {
    render(
      <MotionProvider>
        <MemoryRouter initialEntries={["/test-track"]}>
          <HoloPage title="The test track" here="test-track">
            x
          </HoloPage>
        </MemoryRouter>
      </MotionProvider>,
    );
    const path = screen.getByRole("navigation", { name: "Pages" });
    expect(within(path).getAllByRole("link").map((l) => l.getAttribute("aria-current"))).toEqual([null, null, null]);
    const more = screen.getByRole("navigation", { name: "More" });
    expect(within(more).getAllByRole("link").map((l) => l.textContent)).toEqual(["Results", "Test track", "Analyst", "Metrics", "Flow"]);
    expect(within(more).getByRole("link", { name: "Test track" }).getAttribute("href")).toBe("/test-track");
    expect(within(more).getByRole("link", { name: "Test track" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("the primitives", () => {
  it("a panel is any element with the class, its state as data, nothing else imposed", () => {
    render(
      <HoloPanel as="article" state="pass" className="mine" aria-label="A run">
        x
      </HoloPanel>,
    );
    const el = screen.getByRole("article", { name: "A run" });
    expect(el.className).toBe("holo-panel mine");
    expect(el.dataset.holoState).toBe("pass");
  });

  it("a tag, a rule with its label, and a trace that screen readers skip", () => {
    const { container } = render(
      <>
        <HoloTag dot>Verified</HoloTag>
        <HoloRule label="What SANT changed" />
        <HoloRule />
        <HoloTrace />
      </>,
    );
    expect(screen.getByText("Verified").className).toContain("holo-tag");
    expect(screen.getByText("Verified").dataset.dot).toBe("true");
    expect(screen.getByText("What SANT changed").closest(".holo-rule")).toBeTruthy();
    const rules = container.querySelectorAll(".holo-rule");
    expect(rules[1].getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".holo-trace")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the hand-off between pages", () => {
  it("plays a short hand-off, then opens the next page, which clears it and takes the focus to its title", () => {
    at("/record", <HandoffLink to="/pipeline" label="Pipeline">Run SANT →</HandoffLink>);
    fireEvent.click(screen.getByRole("link", { name: "Run SANT →" }));
    // The hand-off is up; the page hasn't changed yet.
    const veil = document.querySelector(".holo-handoff") as HTMLElement;
    expect(veil).toBeTruthy();
    expect(veil.textContent).toContain("Pipeline");
    expect(screen.queryByText("pipeline page")).toBeNull();
    act(() => vi.advanceTimersByTime(HANDOFF_IN_MS));
    expect(screen.getByText("pipeline page")).toBeTruthy();
    // The new page arrived: the veil lifts and goes.
    expect(veil.dataset.state).toBe("out");
    act(() => vi.advanceTimersByTime(1000));
    expect(document.querySelector(".holo-handoff")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "The pipeline" }));
  });

  it("is a plain, immediate link with reduced motion", () => {
    reducedMotion(true);
    at("/record", <HandoffLink to="/pipeline" label="Pipeline">Run SANT →</HandoffLink>);
    fireEvent.click(screen.getByRole("link", { name: "Run SANT →" }));
    expect(document.querySelector(".holo-handoff")).toBeNull();
    expect(screen.getByText("pipeline page")).toBeTruthy();
    // Still the same place for the focus: the new page's title.
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "The pipeline" }));
  });

  it("leaves a click with a modifier (a new tab) to the browser", () => {
    at("/record", <HandoffLink to="/pipeline" label="Pipeline">Run SANT →</HandoffLink>);
    fireEvent.click(screen.getByRole("link", { name: "Run SANT →" }), { ctrlKey: true });
    expect(document.querySelector(".holo-handoff")).toBeNull();
  });

  it("never leaves the veil up: a page without the frame still gets it cleared", () => {
    render(
      <MotionProvider>
        <MemoryRouter initialEntries={["/record"]}>
          <Routes>
            <Route path="/record" element={<HandoffLink to="/elsewhere" label="Elsewhere">Go</HandoffLink>} />
            <Route path="/elsewhere" element={<p>no frame here</p>} />
          </Routes>
        </MemoryRouter>
      </MotionProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Go" }));
    act(() => vi.advanceTimersByTime(HANDOFF_IN_MS));
    expect(screen.getByText("no frame here")).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(document.querySelector(".holo-handoff")).toBeNull();
  });

  it("a second click during the hand-off doesn't start another", () => {
    at("/record", <HandoffLink to="/pipeline" label="Pipeline">Run SANT →</HandoffLink>);
    const link = screen.getByRole("link", { name: "Run SANT →" });
    fireEvent.click(link);
    fireEvent.click(link);
    expect(document.querySelectorAll(".holo-handoff")).toHaveLength(1);
  });
});
