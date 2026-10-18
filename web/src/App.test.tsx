import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import App from "./App";

// Only the routing is under test: the heavy pages, the providers and the hand cursor are stubbed.
vi.mock("./site/landing/LandingPage", () => ({ default: () => <p>site landing</p> }));
vi.mock("./sant/SantRoot", () => ({ SantRoot: () => <Outlet /> }));
vi.mock("./hand/integration/useHandPointer", () => ({
  useHandPointer: () => ({ enabled: false, status: "off", enable: () => {}, disable: () => {} }),
}));
vi.mock("./hand/overlay/HandCursorOverlay", () => ({ HandCursorOverlay: () => null }));
vi.mock("./hand/overlay/CalibrationPanel", () => ({ CalibrationPanel: () => null }));
vi.mock("./hand/integration/HandToggle", () => ({ HandToggle: () => null }));
vi.mock("./legacy/pages/Landing", () => ({ default: () => <p>legacy landing</p> }));
vi.mock("./legacy/pages/Entry", () => ({ default: () => <p>legacy entry</p> }));
vi.mock("./legacy/pages/Home", () => ({ default: () => <p>legacy home</p> }));
vi.mock("./legacy/pm/record/RecordPage", () => ({ default: () => <p>legacy record</p> }));

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

afterEach(cleanup);

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
      <MemoryRouter initialEntries={["/pm/record?cam=1#top"]}>
        <App />
        <Full />
      </MemoryRouter>,
    );
    expect(await screen.findByText("legacy record")).toBeTruthy();
    expect(screen.getByTestId("full").textContent).toBe("/legacy/pm/record?cam=1#top");
  });
});

function Full() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="full">{pathname + search + hash}</output>;
}
