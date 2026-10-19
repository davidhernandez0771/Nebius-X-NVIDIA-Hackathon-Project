import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import App from "./App";

// The archive, the new Record and the hand cursor around the journey (App.test.tsx covers the journey
// itself). Only the routing is under test: the heavy pages, the providers and the hand cursor are stubbed.
vi.mock("./world/core/WorldRoot", () => ({ default: () => <p>journey</p> }));
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

function Full() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="full">{pathname + search + hash}</output>;
}

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
      <Full />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  hand.enabled = false;
  hand.disable = () => {};
});

describe("App routes around the journey", () => {
  // /home and /enter are the old site's unprefixed URLs; /site was the SANT landing before the journey.
  it.each(["/welcome", "/no-such-page", "/home", "/enter", "/site", "/landing/pinch-sheet"])("%s goes to the journey at /", async (path) => {
    at(path);
    expect(await screen.findByText("journey")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/");
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

  it("opens /pm/review in the work shell, keeping the query and the hash", async () => {
    at("/pm/review?id=abc#top");
    expect(await screen.findByText("legacy review")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Pipeline" })).toBeTruthy();
    expect(screen.getByTestId("full").textContent).toBe("/pm/review?id=abc#top");
  });

  it("opens the new Record for the live test's and the cartridges' /pm/record, keeping the query and the hash", async () => {
    at("/pm/record?trace#top");
    expect(await screen.findByText("new record")).toBeTruthy();
    expect(screen.getByTestId("full").textContent).toBe("/record?trace#top");
  });
});

describe("hand control", () => {
  const controls = () => ({
    toggle: screen.queryAllByRole("button", { name: "Hand control" }),
    gear: screen.queryAllByRole("button", { name: "Hand-control calibration" }),
    overlay: screen.queryAllByTestId("hand-overlay"),
  });

  it.each(["/legacy", "/legacy/home", "/legacy/pm/record"])("shows one toggle, gear and cursor on %s", async (path) => {
    at(path);
    await screen.findByText(/^legacy (landing|home|record)$/);
    const c = controls();
    expect([c.toggle.length, c.gear.length, c.overlay.length]).toEqual([1, 1, 1]);
  });

  it.each(["/", "/design", "/record"])("hides all three on %s", async (path) => {
    at(path);
    const c = controls();
    expect([c.toggle.length, c.gear.length, c.overlay.length]).toEqual([0, 0, 0]);
  });

  it("turns a camera left on off when leaving /legacy, and leaves it on inside", () => {
    hand.enabled = true;
    hand.disable = vi.fn();
    at("/legacy/home");
    expect(hand.disable).not.toHaveBeenCalled();
    cleanup();
    at("/");
    expect(hand.disable).toHaveBeenCalled();
  });
});
