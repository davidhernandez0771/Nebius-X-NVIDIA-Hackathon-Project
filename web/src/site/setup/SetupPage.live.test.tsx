import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { RECORDED } from "./client";
import { SetupPage } from "./SetupPage";

vi.mock("./RobotPreview", () => ({ default: () => <div data-testid="preview" /> }));

// A stand-in for T2's backend (byor-api.md): one stored robot whose last card was run with the hand moved to link 7.
const card = { ...RECORDED.franka.report, provenance: { git_commit: "41d1268" } };
const roles = { ...RECORDED.franka.roles.roles, hand: "panda_link7", mount: { pos: [0.1, 0, 0] as [number, number, number] } };
const summary = {
  id: "byor_3292d47ab6",
  name: "panda",
  uploaded_at: "2026-10-18T17:33:00Z",
  roles_set: true,
  report_status: "done",
  headline: { pick_place: "30/30", reach: 1 },
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function backend() {
  return vi.fn(async (url: string) => {
    const path = url.replace("http://localhost:8000", "");
    if (path === "/robots") return json([summary]);
    if (path === "/robots/byor_3292d47ab6/parts") return json(RECORDED.franka.parts);
    if (path === "/robots/byor_3292d47ab6/report") return json({ status: "done", progress: null, report: { ...card, roles }, error: null });
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function page() {
  return render(
    <MemoryRouter initialEntries={["/robots/setup"]}>
      <MotionProvider>
        <SetupPage />
      </MotionProvider>
    </MemoryRouter>,
  );
}

describe("SetupPage on T2's backend", () => {
  it("lists the robots the backend has, with no sample data in sight", async () => {
    vi.stubGlobal("fetch", backend());
    page();
    expect(await screen.findByRole("heading", { name: "Robots on the backend" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^panda/ })).toBeTruthy();
    expect(screen.getByText("Backend connected")).toBeTruthy();
    expect(screen.queryByText("Sample data")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sample robots" })).toBeNull();
  });

  it("opens a stored robot with the roles and mount of its last card, and shows that card", async () => {
    vi.stubGlobal("fetch", backend());
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^panda/ }));
    await screen.findByRole("heading", { name: "panda" });
    expect(screen.getByText("stored on the backend")).toBeTruthy();
    const link7 = document.querySelector<HTMLElement>('[data-part="panda_link7"]')!;
    expect(within(link7).getByText("Hand")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Report card" }));
    expect(await screen.findByText("30")).toBeTruthy();
    expect(screen.getByText(/base at 0\.10, 0\.00, 0\.00 m/)).toBeTruthy();
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("falls back to the samples when the backend doesn't answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    page();
    expect(await screen.findByRole("heading", { name: "Sample robots" })).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });
});
