import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { GRIPPER, initialHud, meanRateHz, stepHud, type HudState } from "./hudModel";
import { GripKnobTile } from "./GripKnob";
import { Trace } from "./HeightTrace";
import { PalmPad } from "./PalmPad";
import { RecordControl, StatusChip } from "./RecordBar";
import { RecordHudPreview } from "./RecordHudPreview";
import { RecordRack } from "./RecordRack";
import { SimStartLoader } from "./SimStartLoader";
import { SESSION } from "./fixture/session";


function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function wrap(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/site/record-hud"]}>
      <MotionProvider>{ui}</MotionProvider>
    </MemoryRouter>,
  );
}

function hudAt(index: number): HudState {
  let s = initialHud();
  for (let i = 0; i <= index; i++) s = stepHud(s, SESSION.frames[i], SESSION.frames[i].landmarks);
  return s;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("fixture/session.json", () => {
  const frames = SESSION.frames;

  it("is a valid HandPoseMsg stream at the ~30 Hz message rate", () => {
    expect(frames.length).toBe(300);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      expect(f.tracking_ok).toBe(true);
      for (const c of f.wrist_uv) expect(c >= 0 && c <= 1).toBe(true);
      expect(f.palm_width).toBeGreaterThan(0);
      expect(Math.abs(f.yaw_rad)).toBeLessThanOrEqual(Math.PI);
      expect(f.landmarks).toHaveLength(21);
      if (i) expect(f.t_ms).toBeGreaterThan(frames[i - 1].t_ms);
    }
    expect(meanRateHz(frames)).toBeCloseTo(30, 2);
  });

  it("closes and opens the gripper through the sim's latch, and stays inside the region", () => {
    let s = initialHud();
    const cmds: number[] = [];
    for (const f of frames) {
      s = stepHud(s, f, f.landmarks);
      cmds.push(s.gripper);
      expect(s.target!.edge).toBe(false);
    }
    const flips = cmds.filter((c, i) => i > 0 && c !== cmds[i - 1]).length;
    expect(flips).toBe(2);
    expect(Math.min(...frames.map((f) => f.pinch_ratio))).toBeLessThan(GRIPPER.closeBelow);
    expect(Math.max(...frames.map((f) => f.pinch_ratio))).toBeGreaterThan(GRIPPER.openAbove);
  });
});

describe("tiles", () => {
  it("shows the gripper state in words and outlines the tile once closed", () => {
    const { container } = wrap(<GripKnobTile pinch={0.24} gripper={1} />);
    expect(screen.getByRole("meter", { name: "Gripper" })).toHaveAttribute("aria-valuetext", "closed, pinch 0.24");
    expect(screen.getByText("1 closed")).toBeInTheDocument();
    expect(container.querySelector(".rh-tile")).toHaveAttribute("data-selected", "true");
  });

  it("turns the palm dot amber at the edge and hides it without a hand", () => {
    const { container, rerender } = render(<PalmPad x={1} y={0.5} edge />);
    expect(container.querySelector(".rh-pad__dot")).toHaveAttribute("data-edge", "true");
    expect(screen.getByRole("img")).toHaveAccessibleName("Palm in the workspace: 1.00 across, 0.50 down, at the edge");
    rerender(<PalmPad x={null} y={null} />);
    expect(container.querySelector(".rh-pad__dot")).toBeNull();
  });

  it("draws one trace point per sample and marks the newest", () => {
    const { container } = render(<Trace history={[0.1, 0.2, 0.3]} range={[0, 0.4]} capacity={10} label="height" />);
    expect(container.querySelector(".rh-trace__line")!.getAttribute("points")!.split(" ")).toHaveLength(3);
    expect(container.querySelector(".rh-trace__head")).toHaveStyle({ left: `${(2 / 9) * 100}%` });
  });

  it("speaks the chip state when the dot is all there is", () => {
    render(
      <>
        <StatusChip label="sim_link" state="ok" />
        <StatusChip label="hand_track" state="wait" detail="lost" />
      </>,
    );
    expect(screen.getByText(/sim_link/)).toHaveTextContent("sim_link: ok");
    expect(screen.getByText(/hand_track/)).toHaveTextContent("hand_tracklost");
  });

  it("keeps the record button's name and carries the state in aria-pressed", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<RecordControl state="recording" elapsedMs={4849} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Record" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("timer")).toHaveTextContent("00:04.8");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<RecordControl state="paused" elapsedMs={4849} disabled />);
    expect(screen.getByRole("button", { name: "Record" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("lists the start-up steps in order with the current one named", () => {
    render(<SimStartLoader steps={["a", "b", "c"]} current={1} elapsedMs={2000} />);
    expect(screen.getByRole("status")).toHaveAccessibleName("starting simulator: b");
    const items = screen.getAllByRole("listitem").map((li) => li.getAttribute("data-state"));
    expect(items).toEqual(["done", "now", "next"]);
  });
});

describe("RecordRack", () => {
  const chips = [{ label: "sim_link", state: "ok" as const }];

  it("fills every channel from the HUD state", () => {
    stubReducedMotion(true);
    // 4.8 s in: lifting with the cube held.
    const hud = hudAt(144);
    wrap(<RecordRack hud={hud} chips={chips} state="recording" elapsedMs={4800} phase="lift" rateHz={30} />);
    const tile = (name: string) => screen.getByRole("region", { name });
    expect(within(tile("gripper_cmd")).getByText("1 closed")).toBeInTheDocument();
    expect(within(tile("ee_target_z · height")).getByText(hud.target!.ee[2].toFixed(3))).toBeInTheDocument();
    expect(within(tile("ee_target_x")).getByText(hud.target!.ee[0].toFixed(3))).toBeInTheDocument();
    expect(within(tile("msg_rate")).getByText("30")).toBeInTheDocument();
    expect(within(tile("episode")).getByText("rec")).toBeInTheDocument();
    expect(screen.getByText("lift")).toBeInTheDocument();
  });

  it("shows dashes before the first tracked message", () => {
    wrap(<RecordRack hud={initialHud()} chips={chips} state="idle" elapsedMs={0} />);
    expect(within(screen.getByRole("region", { name: "ee_target_x" })).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "palm_xy" })).getByText("—, —")).toBeInTheDocument();
  });
});

describe("RecordHudPreview", () => {
  it("holds mid-lift with reduced motion and switches between preview states", () => {
    stubReducedMotion(true);
    wrap(<RecordHudPreview />);
    expect(screen.getByText("lift")).toBeInTheDocument();
    expect(screen.getByText("1 closed")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00:04.8");

    fireEvent.click(screen.getByRole("button", { name: "Starting simulator" }));
    expect(screen.getByRole("status", { name: /starting simulator/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Hand lost" }));
    expect(screen.getByText(/Show your hand to the camera/)).toBeInTheDocument();
    expect(screen.getByText("hand lost")).toBeInTheDocument();
    // The arm holds its last target, so the gripper stays closed.
    expect(screen.getByText("1 closed")).toBeInTheDocument();
  });
});
