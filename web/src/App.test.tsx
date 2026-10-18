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
  it.each(["/", "/welcome", "/no-such-page"])("%s goes to the SANT landing at /site", async (path) => {
    at(path);
    expect(await screen.findByText("site landing")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/site");
  });
});
