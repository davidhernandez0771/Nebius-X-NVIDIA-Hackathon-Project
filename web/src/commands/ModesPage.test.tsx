// Component-level coverage standing in for a live browser check: /modes
// isn't wired into App.tsx's router yet (coordinator does that at
// integration, see SANT_VOICE_MODES_PLAN.md §8).

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ModesPage from "./ModesPage";
import { __resetLaunchGuardForTests } from "./modes";
import { localStorageCommandsRepository } from "./store";
import type { Mode } from "./types";

// See CommandsPage.test.tsx: vitest.config.ts has no test.globals, so RTL's
// auto-cleanup never registers -- do it explicitly.
afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <ModesPage />
    </MemoryRouter>,
  );
}

function seedMode(overrides: Partial<Mode> = {}): Mode {
  const mode: Mode = {
    id: "mode-1",
    name: "Focus mode",
    links: [{ id: "link-1", kind: "external", label: "Docs", url: "https://example.com" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  localStorageCommandsRepository.saveModes([mode]);
  return mode;
}

beforeEach(() => {
  localStorage.clear();
  __resetLaunchGuardForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModesPage", () => {
  it("creates a mode with an added link and lists it", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Deep focus"), { target: { value: "Morning routine" } });
    fireEvent.change(screen.getByPlaceholderText("Label"), { target: { value: "Inbox" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com"), { target: { value: "https://mail.example.com" } });
    fireEvent.click(screen.getByText("Add link"));
    fireEvent.click(screen.getByText("Add mode"));

    expect(screen.getByRole("heading", { name: "Morning routine" })).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "SPAN" && element.textContent === "Inbox (external: https://mail.example.com)",
      ),
    ).toBeInTheDocument();
  });

  it("rejects an unsafe link scheme before it's added", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Label"), { target: { value: "Bad" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Add link"));
    expect(screen.getByText(/scheme/i)).toBeInTheDocument();
  });

  it("requires reviewing contents before activating, then reports a per-link result", () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    seedMode();
    renderPage();

    fireEvent.click(screen.getByText("Activate"));
    expect(screen.getByText(/activating will open these 1 link/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm & activate"));
    expect(screen.getByText("Opened")).toBeInTheDocument();
  });

  it("shows Blocked with a Retry control when the popup is blocked, and retry can recover it", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValueOnce(null).mockReturnValue({} as Window);
    seedMode();
    renderPage();

    fireEvent.click(screen.getByText("Activate"));
    fireEvent.click(screen.getByText("Confirm & activate"));
    expect(screen.getByText("Blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it("duplicates a mode with a cleared phrase so it never immediately conflicts with the original", () => {
    seedMode({ phrase: "start focus mode" });
    renderPage();
    fireEvent.click(screen.getByText("Duplicate"));

    expect(screen.getByRole("heading", { name: "Focus mode (copy)" })).toBeInTheDocument();
    const modes = localStorageCommandsRepository.loadModes();
    const copy = modes.find((m) => m.name === "Focus mode (copy)");
    expect(copy?.phrase).toBeUndefined();
  });

  it("deletes a mode from the list and storage", () => {
    seedMode();
    renderPage();
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByRole("heading", { name: "Focus mode" })).not.toBeInTheDocument();
    expect(localStorageCommandsRepository.loadModes()).toEqual([]);
  });
});
