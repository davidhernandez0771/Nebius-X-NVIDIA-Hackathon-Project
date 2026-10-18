import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import App from "./App";

// Only the routing is under test: the heavy pages, the providers and the hand cursor are stubbed.
vi.mock("./site/landing/LandingPage", () => ({ default: () => <p>site landing</p> }));
vi.mock("./sant/SantRoot", () => ({ SantRoot: () => <Outlet /> }));
const hand = vi.hoisted(() => ({ enabled: false, disable: (() => {}) as () => void }));
vi.mock("./hand/integration/useHandPointer", () => ({
  useHandPointer: () => ({ enabled: hand.enabled, status: "off", enable: () => {}, disable: hand.disable }),
}));
vi.mock("./hand/overlay/HandCursorOverlay", () => ({ HandCursorOverlay: () => <div data-testid="hand-overlay" /> }));
vi.mock("./hand/overlay/CalibrationPanel", () => ({ CalibrationPanel: () => null }));
vi.mock("./hand/integration/HandToggle", () => ({ HandToggle: () => <button type="button">Hand control</button> }));
vi.mock("./legacy/pages/Landing", () => ({ default: () => <p>legacy landing</p> }));
vi.mock("./legacy/pages/Entry", () => ({ default: () => <p>legacy entry</p> }));
vi.mock("./legacy/pages/Home", () => ({ default: () => <p>legacy home</p> }));
vi.mock("./legacy/pm/record/RecordPage", () => ({ default: () => <p>legacy record</p> }));
vi.mock("./legacy/pm/review/ReviewPage", () => ({ default: () => <p>legacy review</p> }));
vi.mock("./site/record/RecordConsole", () => ({ default: () => <p>new record</p> }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  hand.enabled = false;
  hand.disable = () => {};
});

describe("App routes", () => {
  // /home and /enter are the old site's unprefixed URLs: only /pm/* is redirected into /legacy.
  it.each(["/", "/welcome", "/no-such-page", "/home", "/enter"])("%s goes to the SANT landing at /site", async (path) => {
    at(path);
    expect(await screen.findByText("site landing")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/site");
  });

  it.each([
    ["/legacy", "legacy landing"],
    ["/legacy/enter", "legacy entry"],
    ["/legacy/home", "legacy home"],
    ["/legacy/pm/record", "legacy record"],
  ])("serves the archived old site at %s", async (path, text) => {
    at(path);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(path);
  });

  it("keeps the old dashboard rail around the legacy pages", async () => {
    at("/legacy/home");
    await screen.findByText("legacy home");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  });

  it("redirects /pm/* to /legacy/pm/*, keeping the query and the hash", async () => {
    render(
      <MemoryRouter initialEntries={["/pm/review?id=abc#top"]}>
        <App />
        <Full />
      </MemoryRouter>,
    );
    expect(await screen.findByText("legacy review")).toBeTruthy();
    expect(screen.getByTestId("full").textContent).toBe("/legacy/pm/review?id=abc#top");
  });

  it("opens the new Record for the live test's /pm/record, keeping the query and the hash", async () => {
    render(
      <MemoryRouter initialEntries={["/pm/record?trace#top"]}>
        <App />
        <Full />
      </MemoryRouter>,
    );
    expect(await screen.findByText("new record")).toBeTruthy();
    expect(screen.getByTestId("full").textContent).toBe("/record?trace#top");
  });
});

function Full() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="full">{pathname + search + hash}</output>;
}

describe("hand control", () => {
  const controls = () => ({
    toggle: screen.queryByRole("button", { name: "Hand control" }),
    gear: screen.queryByRole("button", { name: "Hand-control calibration" }),
    overlay: screen.queryByTestId("hand-overlay"),
  });

  it.each(["/legacy", "/legacy/home", "/legacy/pm/record"])("shows the toggle, the gear and the cursor on %s", async (path) => {
    at(path);
    await screen.findByText(/^legacy (landing|home|record)$/);
    const c = controls();
    expect(c.toggle && c.gear && c.overlay).toBeTruthy();
  });

  it.each(["/site", "/design", "/landing/pinch-sheet"])("hides all three on %s", (path) => {
    at(path);
    expect(controls()).toEqual({ toggle: null, gear: null, overlay: null });
  });

  it("turns a camera left on off when leaving /legacy, and leaves it on inside", () => {
    hand.enabled = true;
    hand.disable = vi.fn();
    at("/legacy/home");
    expect(hand.disable).not.toHaveBeenCalled();
    cleanup();
    at("/site");
    expect(hand.disable).toHaveBeenCalled();
  });
});
