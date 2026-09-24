// Component-level coverage standing in for a live browser check: /commands
// isn't wired into App.tsx's router yet (coordinator does that at
// integration, see SANT_VOICE_MODES_PLAN.md §8), so this exercises the real
// component tree (jsdom + @testing-library/react) instead.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { __resetRegistryForTests, registerAction } from "../actions/registry";
import CommandsPage from "./CommandsPage";
import { localStorageCommandsRepository } from "./store";

function renderPage() {
  return render(
    <MemoryRouter>
      <CommandsPage />
    </MemoryRouter>,
  );
}

// vitest.config.ts doesn't set test.globals, so @testing-library/react's
// auto-cleanup (which looks for a global afterEach) never registers -- do it
// explicitly, or DOM from one test leaks into the next in the same file.
afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  __resetRegistryForTests();
  registerAction({
    id: "hand_control.enable",
    description: "turn on hand-tracked cursor control",
    isAvailable: () => true,
    execute: () => ({ ok: true, message: "Hand control turned on" }),
  });
  registerAction({
    id: "navigate",
    description: "go to a page",
    args: { destination: { type: "string", required: true, enum: ["home", "settings"] } },
    isAvailable: () => true,
    execute: () => ({ ok: true, message: "Opened" }),
  });
});

describe("CommandsPage", () => {
  it("creates a command and lists it", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Camera control on"), { target: { value: "Hand on" } });
    fireEvent.change(screen.getByPlaceholderText("activate camera control"), {
      target: { value: "activate camera control" },
    });
    fireEvent.click(screen.getByText("Add command"));

    expect(screen.getByRole("heading", { name: "Hand on" })).toBeInTheDocument();
    expect(screen.getByText(/sant, activate camera control/i)).toBeInTheDocument();
  });

  it("blocks saving a phrase that conflicts with an existing enabled command", () => {
    localStorageCommandsRepository.saveCommands([
      {
        id: "cmd-1",
        displayName: "Existing",
        phrase: "go home",
        aliases: [],
        actionId: "hand_control.enable",
        args: {},
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Camera control on"), { target: { value: "Second" } });
    fireEvent.change(screen.getByPlaceholderText("activate camera control"), { target: { value: "go home" } });
    fireEvent.click(screen.getByText("Add command"));

    expect(screen.getByText("That phrase conflicts with: Existing. Choose a different phrase.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Second" })).not.toBeInTheDocument();
  });

  it("runs a real executeAction() call from the Test button and shows the result", async () => {
    localStorageCommandsRepository.saveCommands([
      {
        id: "cmd-1",
        displayName: "Hand on",
        phrase: "activate camera control",
        aliases: [],
        actionId: "hand_control.enable",
        args: {},
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    fireEvent.click(screen.getByText("Test"));
    expect(await screen.findByText("Hand control turned on")).toBeInTheDocument();
  });

  it("toggling enabled persists to the repository", () => {
    localStorageCommandsRepository.saveCommands([
      {
        id: "cmd-1",
        displayName: "Hand on",
        phrase: "activate camera control",
        aliases: [],
        actionId: "hand_control.enable",
        args: {},
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Hand on" }));
    expect(localStorageCommandsRepository.loadCommands()[0].enabled).toBe(false);
  });

  it("deleting a command removes it from the list and storage", () => {
    localStorageCommandsRepository.saveCommands([
      {
        id: "cmd-1",
        displayName: "Hand on",
        phrase: "activate camera control",
        aliases: [],
        actionId: "hand_control.enable",
        args: {},
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByRole("heading", { name: "Hand on" })).not.toBeInTheDocument();
    expect(localStorageCommandsRepository.loadCommands()).toEqual([]);
  });
});
