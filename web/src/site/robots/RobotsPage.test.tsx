import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { RobotsPage } from "./RobotsPage";

// jsdom has no WebGL, so the page shows the still shelf: the same list, cartridges and title block.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage() {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/robots"]}>
        <RobotsPage />
      </MemoryRouter>
    </MotionProvider>,
  );
  await act(async () => {});
}

const listButton = (name: RegExp) => screen.getAllByRole("button", { name }).find((b) => b.closest("nav"))!;

describe("RobotsPage", () => {
  it("lists every robot with its status", async () => {
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "Robots" });
    expect(nav.querySelectorAll("button")).toHaveLength(6);
    expect(nav.textContent).toContain("OpenArmDesign flaw, 2026");
  });

  // site-nav (2026-10-26): the page had no way back at all (Escape only drops a picked robot).
  it("has the way back to the workshop, top left after the mark", async () => {
    await renderPage();
    const back = screen.getByRole("link", { name: "Back to workshop" });
    expect(back.getAttribute("href")).toBe("/");
    expect(document.querySelector(".robots-top a")).toBe(back);
  });

  it("shows the verified-copies count in the top bar", async () => {
    await renderPage();
    expect(screen.getByText(/copies 100\/100 verified/)).toBeTruthy();
  });

  it("falls back to the still shelf without WebGL", async () => {
    await renderPage();
    expect(document.querySelector(".flat-shelf")).not.toBeNull();
    expect(document.querySelector(".robots-hud")).toBeNull();
  });

  it("picks a robot from the list, then drops it on a second click", async () => {
    await renderPage();
    const b = listButton(/Flexiv Rizon 4s/);
    fireEvent.click(b);
    expect(b.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector(".flat-shelf__title")?.textContent).toContain("9/30 · gripper drag");
    fireEvent.click(b);
    expect(b.getAttribute("aria-current")).toBe("false");
  });

  it("picks a robot by its cartridge and drops it with Escape", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("listitem", { name: "OpenArm, Design flaw" }));
    expect(listButton(/OpenArm/).getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(listButton(/OpenArm/).getAttribute("aria-current")).toBe("false");
  });

  it("announces the pick for screen readers", async () => {
    await renderPage();
    fireEvent.click(listButton(/Franka Panda/));
    expect(document.querySelector(".robots-sr")?.textContent).toContain("Franka Panda: Tested, 30/30 copies · 3/40 → 17/40");
  });
});
