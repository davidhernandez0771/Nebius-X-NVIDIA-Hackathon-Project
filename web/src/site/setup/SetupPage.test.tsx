import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { SetupPage } from "./SetupPage";

vi.mock("./RobotPreview", () => ({ default: () => <div data-testid="preview" /> }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // not in jsdom
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
    <MemoryRouter initialEntries={["/robots/setup?fixture=1"]}>
      <MotionProvider>
        <SetupPage />
      </MotionProvider>
    </MemoryRouter>,
  );
}

/** The tree row of a link, or of the joint that moves it (one row holds both). */
const row = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"], [data-joint="${name}"]`)!;

describe("SetupPage", () => {
  it("starts with the upload zone and, without the backend, the samples under a Sample data tag", async () => {
    page();
    expect(await screen.findByText("Drop your robot's URDF here")).toBeTruthy();
    expect(await screen.findByText(/isn't running, so this page shows T2's recorded runs/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sample robots" })).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThanOrEqual(3); // nav, banner, list
  });

  it("tags an open sample robot and its card as sample data", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^openarm/ }));
    expect(await screen.findByRole("button", { name: /Sample data: T2's recorded run, not your robot/ })).toBeTruthy();
  });

  it("opens a recorded robot with the suggested roles pre-filled", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^openarm/ }));
    expect(await screen.findByRole("heading", { name: "openarm" })).toBeTruthy();
    expect(within(row("openarm_link0")).getByText("Base")).toBeTruthy();
    expect(within(row("openarm_joint6")).getByText("Arm")).toBeTruthy();
    expect(within(row("openarm_joint6")).getByText("±45°")).toBeTruthy();
    expect(within(row("openarm_finger_joint2")).getByText(/mimic/)).toBeTruthy();
    expect(row("openarm_finger_joint2").title).toBe("openarm_finger_joint2 follows openarm_finger_joint1");
    expect(screen.getByText(/the start pose did not converge/)).toBeTruthy();
  });

  it("removes a role from a part and shows the backend's code for the problem", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^panda/ }));
    await screen.findByRole("heading", { name: "panda" });
    for (const j of ["panda_joint5", "panda_joint6", "panda_joint7"])
      fireEvent.click(screen.getByRole("button", { name: `Remove ${j} from Arm` }));
    expect(screen.getByText("arm_too_short")).toBeTruthy();
  });

  it("wires a role from the keyboard: arm the socket, pick parts, Escape", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^panda/ }));
    await screen.findByRole("heading", { name: "panda" });
    fireEvent.click(screen.getByRole("button", { name: "Remove panda_hand from Hand" }));
    const socket = document.querySelector<HTMLElement>('[data-socket="hand"]')!;
    fireEvent.keyDown(socket, { key: "Enter" });
    expect(socket.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(row("panda_link8")).getByRole("button", { name: /panda_link8: add to Hand/ }));
    expect(within(row("panda_link8")).getByText("Hand")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(socket.getAttribute("aria-pressed")).toBe("false");
    // Arm lands on a row's joint, so the root row (no joint) can't take it
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-socket="arm"]')!, { key: "Enter" });
    expect(row("panda_link0").dataset.takes).toBe("false");
    expect(row("panda_joint3").dataset.takes).toBe("true");
  });

  it("runs the report card: roles saved, progress by stage, then the card", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      page();
      fireEvent.click(await screen.findByRole("button", { name: /^openarm/ }));
      await screen.findByRole("heading", { name: "openarm" });
      fireEvent.click(screen.getAllByRole("button", { name: "Run report card" })[0]);
      await act(() => vi.advanceTimersByTimeAsync(1200));
      expect(screen.getByRole("button", { name: "Running…" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Report card" }).getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector(".byor-progress")).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(9000));
      expect(await screen.findByRole("region", { name: "Design flaw found" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Run again" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Parts and roles" }));
      expect(row("openarm_joint6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains an upload the recorded data doesn't know", async () => {
    page();
    await screen.findByText("Drop your robot's URDF here");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['<robot name="so101"/>'], "so101.urdf")] } });
    expect(await screen.findByText("fixture_unknown")).toBeTruthy();
  });
});
