// The 2D pages' way back into the world (site-nav, 2026-10-26): Record's "⏏ workshop" was a small chip that read
// like a label, /robots had no way back at all, and the story pages' mark went to the top of the intro.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackToWorkshop } from "./BackToWorkshop";

function renderAt(path = "/record") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<h1>The world</h1>} />
        <Route path="*" element={<BackToWorkshop />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Back to workshop", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it("is a real link to the world, labelled in words (the arrow is decoration)", () => {
    renderAt();
    const link = screen.getByRole("link", { name: "Back to workshop" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toBe("←Back to workshop");
    expect(link.querySelector("[aria-hidden='true']")?.textContent).toBe("←");
  });

  it("lands in the workshop's room view, not at the top of the story", () => {
    renderAt();
    fireEvent.click(screen.getByRole("link", { name: "Back to workshop" }));
    expect(screen.getByRole("heading", { name: "The world" })).toBeTruthy();
    expect(sessionStorage.getItem("world.return")).toBe("workshop");
  });

  it("keeps the place the visitor left from (the machine, saved by the projection's hand-off)", () => {
    sessionStorage.setItem("world.return", "machine");
    renderAt();
    fireEvent.click(screen.getByRole("link", { name: "Back to workshop" }));
    expect(sessionStorage.getItem("world.return")).toBe("machine");
  });
});
