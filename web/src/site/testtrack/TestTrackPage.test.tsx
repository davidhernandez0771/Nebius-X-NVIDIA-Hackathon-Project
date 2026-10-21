import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { clearTrackCache } from "./api";
import { INDEX, RUN } from "./fixtures";
import TestTrackPage from "./TestTrackPage";

vi.mock("../../twin", () => ({
  RobotTwin: (p: { caption?: string; viewKey?: number; look?: string; trails?: { dashed?: boolean; upto: number }[] | null; framePoints?: unknown[] | null }) => (
    <div
      data-testid="twin"
      data-view={p.viewKey}
      data-look={p.look}
      data-trails={(p.trails ?? []).map((t) => `${t.dashed ? "dashed" : "solid"}@${t.upto}`).join(",")}
      data-frame={p.framePoints?.length ?? 0}
    >
      {p.caption}
    </div>
  ),
}));

function files(fail = false) {
  return vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname.replace(/^\/test-track-data\//, "");
    const seed = /^runs\/[\w-]+\/(\d+)\.json$/.exec(path)?.[1];
    const body = fail ? null : path === "index.json" ? INDEX : seed ? RUN({ demo_id: `teacher_${seed}`, cube_source: path.includes("distill") ? "estimated" : "recorded" }) : null;
    return new Response(JSON.stringify(body ?? { detail: "Not Found" }), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function page(url = "/test-track", fetchImpl = files()) {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <TestTrackPage fetchImpl={fetchImpl} />
      </MemoryRouter>
    </MotionProvider>,
  );
  return fetchImpl;
}

const key = (k: string, over: Record<string, unknown> = {}) => act(() => void fireEvent.keyDown(window, { key: k, ...over }));

beforeEach(() => {
  clearTrackCache();
  // reduced motion: the replay starts paused, so the step on screen is the one the test set
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the test track", () => {
  it("opens on the first source's first run: the replay, SANT's verdict and the run's facts", async () => {
    page();
    expect(await screen.findByRole("heading", { level: 1, name: "The test track" })).toBeTruthy();
    expect(await screen.findByText("Isaac Sim replay · seed 5350 · step 1 of 4")).toBeTruthy();
    expect(screen.getByText("2/2 verified by SANT replay · Wilson 95% 93%–100%")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/SANT · seed 5350.*In the bin · verified/);
    expect(screen.getByText("Teacher's own check: pass · replay agrees: yes")).toBeTruthy();
    expect(screen.getByText("2.82 s")).toBeTruthy();
    expect(screen.getByText("recorded by Isaac")).toBeTruthy();
    expect(screen.getByText("0.0 N")).toBeTruthy(); // the arm's contact at this step
    expect(screen.getByRole("button", { name: "Seed 5350: verified" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Test track" }).getAttribute("aria-current")).toBe("page");
  });

  it("says which source isn't there yet instead of hiding it", async () => {
    page();
    const later = await screen.findByRole("button", { name: /Camera robot · eval/ });
    expect((later as HTMLButtonElement).disabled).toBe(true);
    expect(later.textContent).toMatch(/hasn't run yet/);
  });

  it("marks round 0's cube as estimated and says how far off the estimate is", async () => {
    page("/test-track?source=distill-r0");
    expect(await screen.findByText("estimated from the gripper")).toBeTruthy();
    expect(screen.getByText(/On 82 runs that recorded both/)).toBeTruthy();
  });

  it("shows a failed rollout's verdict without a replay, and fetches nothing for it", async () => {
    const f = page("/test-track?source=distill-r0&run=4022");
    expect(await screen.findByText(/This rollout saved no replay/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Failed · dropped the cube, stopped at the time limit/);
    expect(screen.queryByTestId("twin")).toBeNull();
    expect(f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("4022"))).toEqual([]);
  });

  it("runs from the keyboard: play, step, speed, the next run, the source, the camera, the help", async () => {
    page();
    await screen.findByText(/step 1 of 4/);
    const play = screen.getByRole("button", { name: "Play" });
    key(" ");
    expect(play.textContent).toBe("Pause");
    key(" ");
    expect(play.textContent).toBe("Play");
    key("ArrowRight");
    expect(screen.getByText(/step 2 of 4/)).toBeTruthy();
    key("ArrowRight", { shiftKey: true });
    expect(screen.getByText(/step 4 of 4/)).toBeTruthy(); // stops at the last step
    key("]");
    expect(screen.getByText("2×")).toBeTruthy();
    key("[");
    key("[");
    expect(screen.getByText("0.5×")).toBeTruthy();
    key("r");
    expect(screen.getByTestId("twin").getAttribute("data-view")).toBe("1");
    key("k");
    expect(await screen.findByText(/seed 5351 · step 1 of 4/)).toBeTruthy();
    key("?");
    expect(screen.getByRole("dialog", { name: "Keyboard" })).toBeTruthy();
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    key("2");
    expect(await screen.findByText(/seed 4000/)).toBeTruthy();
  });

  it("draws the arm in the studio look, framed wide, with the hand's and the cube's paths up to now", async () => {
    page();
    await screen.findByText(/step 1 of 4/);
    const twin = screen.getByTestId("twin");
    expect(twin.getAttribute("data-look")).toBe("studio");
    expect(Number(twin.getAttribute("data-frame"))).toBe(3 + 4 + 4); // the robot (2), the bin, the cube's 4 and the hand's 4
    expect(twin.getAttribute("data-trails")).toBe("solid@0,solid@0");
    key("ArrowRight");
    expect(screen.getByTestId("twin").getAttribute("data-trails")).toBe("solid@1,solid@1");
    const paths = screen.getByRole("button", { name: "Paths" });
    expect(paths.getAttribute("aria-pressed")).toBe("true");
    key("t");
    expect(paths.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("twin").getAttribute("data-trails")).toBe("");
    fireEvent.click(paths);
    expect(screen.getByTestId("twin").getAttribute("data-trails")).toBe("solid@1,solid@1");
  });

  it("dashes the cube's path where it is an estimate", async () => {
    page("/test-track?source=distill-r0");
    await screen.findByText(/seed 4000/);
    expect(screen.getByTestId("twin").getAttribute("data-trails")).toBe("solid@0,dashed@0");
  });

  it("picks a run from the grid", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Seed 5351: verified" }));
    expect(await screen.findByText(/seed 5351/)).toBeTruthy();
  });

  it("keeps the boot console up with ?boot=1, with what it loaded", async () => {
    page("/test-track?boot=1");
    await screen.findByText(/step 1 of 4/);
    const boot = screen.getByRole("list", { name: "Loading" });
    expect(boot.textContent).toMatch(/index · 2 sources · 4 runs · 3 replays/);
    expect(boot.textContent).toMatch(/run teacher_5350 · 4 steps at 50 Hz/);
  });

  it("says so in the boot console when the index doesn't load", async () => {
    page("/test-track", files(true));
    await waitFor(() => expect(screen.getByText(/the index didn't load: index.json: HTTP 404/)).toBeTruthy());
  });
});
