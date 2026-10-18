import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { SetupPage } from "./SetupPage";

vi.mock("./RobotPreview", () => ({ default: () => <div data-testid="preview" /> }));

beforeEach(() => {
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

const row = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)!;

describe("SetupPage", () => {
  it("starts with the upload zone and says it runs on recorded data", async () => {
    page();
    expect(await screen.findByText("Drop your robot's URDF here")).toBeTruthy();
    expect(await screen.findByText(/isn't answering, so this page runs on recorded data/)).toBeTruthy();
  });

  it("opens a recorded robot with the suggested roles pre-filled", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "OpenArm" }));
    expect(await screen.findByRole("heading", { name: "openarm" })).toBeTruthy();
    expect(within(row("openarm_link0")).getByText("Base")).toBeTruthy();
    expect(within(row("openarm_joint6")).getByText("Arm")).toBeTruthy();
    expect(within(row("openarm_joint6")).getByText("±45°")).toBeTruthy();
    expect(within(row("openarm_finger_joint2")).getByText(/follows openarm_finger_joint1/)).toBeTruthy();
    expect(screen.getByText(/the start pose did not converge/)).toBeTruthy();
  });

  it("removes a role from a part and shows the backend's code for the problem", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Franka" }));
    await screen.findByRole("heading", { name: "panda" });
    for (const j of ["panda_joint5", "panda_joint6", "panda_joint7"])
      fireEvent.click(screen.getByRole("button", { name: `Remove ${j} from Arm` }));
    expect(screen.getByText("arm_too_short")).toBeTruthy();
  });

  it("wires a role from the keyboard: arm the socket, pick parts, Escape", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Franka" }));
    await screen.findByRole("heading", { name: "panda" });
    fireEvent.click(screen.getByRole("button", { name: "Remove panda_hand from Hand" }));
    const socket = document.querySelector<HTMLElement>('[data-socket="hand"]')!;
    fireEvent.keyDown(socket, { key: "Enter" });
    expect(socket.getAttribute("aria-pressed")).toBe("true");
    expect(row("panda_joint1").dataset.takes).toBe("false");
    fireEvent.click(within(row("panda_link8")).getByRole("button", { name: /add to Hand/ }));
    expect(within(row("panda_link8")).getByText("Hand")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(socket.getAttribute("aria-pressed")).toBe("false");
  });

  it("explains an upload the recorded data doesn't know", async () => {
    page();
    await screen.findByText("Drop your robot's URDF here");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['<robot name="so101"/>'], "so101.urdf")] } });
    expect(await screen.findByText("fixture_unknown")).toBeTruthy();
  });
});
