import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { clearClipCache } from "./api";
import { CLIP, RAW_RUN, V2_RUN } from "./fixtures";
import { LookClip } from "./LookClip";
import LookClipPage from "./LookClipPage";

vi.mock("../../twin", () => ({
  RobotTwin: (p: { caption?: string; framePoints?: unknown[] | null; interactive?: boolean; look?: string }) => (
    <div data-testid="twin" data-frame={p.framePoints?.length ?? 0} data-interactive={String(p.interactive)} data-look={p.look}>
      {p.caption}
    </div>
  ),
}));

function files(missing = false) {
  return vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname.replace(/^\/look-clip\//, "");
    const m = /^runs\/(raw|v2)\/(\d+)\.json$/.exec(path);
    const body = missing ? null : path === "index.json" ? CLIP : m ? (m[1] === "raw" ? RAW_RUN : V2_RUN)(Number(m[2])) : null;
    return new Response(JSON.stringify(body ?? { detail: "Not Found" }), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

let reduce = true;
beforeEach(() => {
  clearClipCache();
  reduce = true;
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(el: JSX.Element, url = "/") {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="*" element={<>{el}<Where /></>} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

const sides = () => screen.getAllByRole("figure");

describe("LookClip", () => {
  it("shows the caption and the two robots side by side, raw left and v2 right, on the same seed", async () => {
    const f = files();
    mount(<LookClip fetchImpl={f} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Same 10 demos. Same scene. 0/40 vs 30/40." })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId("twin")).toHaveLength(2));
    const [left, right] = sides();
    expect(left.getAttribute("aria-label")).toBe("Copying the 10 raw demos: 0/40 on seeds 5020–5059");
    expect(right.getAttribute("aria-label")).toBe("SANT v2: 30/40 on seeds 5400–5439");
    for (const s of [left, right]) expect(within(s).getByTestId("twin").textContent).toMatch(/^Isaac Sim · seed 5403 · /);
    expect(screen.getByText(/Illustrative replay · picked to show the difference · seed 5403/)).toBeTruthy();
    // one camera for both: the same framing points (robot, both bins, both paths)
    const frames = screen.getAllByTestId("twin").map((t) => t.getAttribute("data-frame"));
    expect(frames).toEqual(["60", "60"]);
    expect(screen.getAllByTestId("twin").every((t) => t.getAttribute("data-interactive") === "false" && t.getAttribute("data-look") === "studio")).toBe(true);
    const asked = f.mock.calls.map(([u]) => String(u));
    expect(asked).toEqual(expect.arrayContaining(["/look-clip/index.json", "/look-clip/runs/raw/5403.json", "/look-clip/runs/v2/5403.json"]));
    expect(asked.some((u) => u.includes("5404"))).toBe(false); // only the pair on screen loads
  });

  it("with reduced motion rests on the result: v2 in the bin, the raw robot's whole-run verdict", async () => {
    mount(<LookClip fetchImpl={files()} />);
    await waitFor(() => expect(sides()[1].getAttribute("data-ok")).toBe("true"));
    const [left, right] = sides();
    expect(left.getAttribute("data-ok")).toBe("false");
    expect(within(right).getByText("✓ In the bin · 7.5 s · verified by SANT")).toBeTruthy();
    expect(within(left).getByText("✕ Failed · never touched the cube · kept trying to the 30 s limit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("From the start shows both robots running, with no verdict yet", async () => {
    mount(<LookClip fetchImpl={files()} />);
    await waitFor(() => expect(sides()[1].getAttribute("data-ok")).toBe("true"));
    act(() => void fireEvent.click(screen.getByRole("button", { name: "From the start" })));
    // it plays now; the first frame is t = 0
    expect(screen.getAllByText(/^Running · 0\.\d s$/)).toHaveLength(2);
    expect(sides().every((s) => s.getAttribute("data-ok") === null)).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("switches scenes with its own buttons and loads that pair", async () => {
    const f = files();
    mount(<LookClip fetchImpl={f} />);
    await waitFor(() => expect(screen.getAllByTestId("twin")).toHaveLength(2));
    const scenes = screen.getByRole("group", { name: "Scenes" });
    expect(within(scenes).getByRole("button", { name: "Scene 1, seed 5403" }).getAttribute("aria-pressed")).toBe("true");
    act(() => void fireEvent.click(within(scenes).getByRole("button", { name: "Scene 2, seed 5404" })));
    await waitFor(() => expect(screen.getAllByTestId("twin")[0].textContent).toMatch(/seed 5404/));
    expect(f.mock.calls.map(([u]) => String(u))).toContain("/look-clip/runs/raw/5404.json");
  });

  it("says how the runs were picked and where each stands against its count", async () => {
    mount(<LookClip fetchImpl={files()} />);
    await waitFor(() => expect(screen.getAllByTestId("twin")).toHaveLength(2));
    const how = screen.getByText("How these runs were picked").closest("details")!;
    expect(within(how).getByText(/^Picked: the seeds where both policies/)).toBeTruthy();
    expect(within(how).getByText(/Run for this picture on seed 5403: not part of its 0\/40/)).toBeTruthy();
    expect(within(how).getByText(/Seed 5403 is one of the runs counted in its 30\/40/)).toBeTruthy();
    expect(within(how).getByRole("link", { name: /All 40 runs of the final test/ }).getAttribute("href")).toBe("/test-track");
  });

  it("without its data, says so and points at the test track instead of an empty frame", async () => {
    mount(<LookClip fetchImpl={files(true)} />);
    expect(await screen.findByText(/The side-by-side replay didn't load/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "The test track" }).getAttribute("href")).toBe("/test-track");
    expect(screen.queryByTestId("twin")).toBeNull();
  });

  it("takes a heading level to fit where it is mounted", async () => {
    mount(<LookClip fetchImpl={files()} headingLevel={3} />);
    expect(await screen.findByRole("heading", { level: 3, name: /0\/40 vs 30\/40/ })).toBeTruthy();
  });
});

describe("LookClipPage (/look)", () => {
  it("opens on ?seed and keeps the scene picked in the URL; the views can be turned", async () => {
    mount(<LookClipPage fetchImpl={files()} />, "/look?seed=5404");
    await waitFor(() => expect(screen.getAllByTestId("twin")[0].textContent).toMatch(/seed 5404/));
    expect(screen.getAllByTestId("twin")[0].getAttribute("data-interactive")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Same scene, two robots" })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Scene 1, seed 5403" })));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/look?seed=5403"));
  });

  it("?embed=1 shows the clip without the page's frame", async () => {
    mount(<LookClipPage fetchImpl={files()} />, "/look?embed=1");
    await waitFor(() => expect(screen.getAllByTestId("twin")).toHaveLength(2));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /0\/40 vs 30\/40/ })).toBeTruthy();
  });
});
