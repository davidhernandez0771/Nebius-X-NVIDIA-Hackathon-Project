import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant";
import ReviewPage2 from "./ReviewPage2";

function renderAt(url: string) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/review2" element={<ReviewPage2 />} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

describe("ReviewPage2 with the recorded example (no backend)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says it is a synthetic recorded example", async () => {
    renderAt("/review2");
    expect(await screen.findByText("Recorded example.")).toBeTruthy();
    expect(screen.getByText(/synthetic demo/)).toBeTruthy();
  });

  it("lists s1_0002's four issues with the fixes the rules applied", () => {
    renderAt("/review2");
    const list = screen.getByRole("heading", { name: "Issues and fixes" }).parentElement!;
    expect(within(list).getByText("PAUSE 2.02 s")).toBeTruthy();
    expect(within(list).getByText("PAUSE 1.60 s")).toBeTruthy();
    expect(within(list).getByText("IDLE 0.82 s")).toBeTruthy();
    expect(within(list).getByText("JITTER")).toBeTruthy();
    expect(within(list).getAllByText("remove_pause")).toHaveLength(2);
    expect(within(list).getByText("trim")).toBeTruthy();
    expect(within(list).getByText("smooth")).toBeTruthy();
  });

  it("gives physics from the replay's passport", () => {
    renderAt("/review2");
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(within(card).getByText("Verified ✓")).toBeTruthy();
    expect(card.textContent).toContain("Replay 9.32 s, path 1.10 m");
    expect(card.textContent).toContain("From the replay's passport.");
    expect(card.textContent).toContain("4 issues, 4 fixes");
    expect(card.textContent).toContain("13.76 s");
  });

  it("shows Nemotron's real label and its match of a named copy, verbatim", () => {
    renderAt("/review2");
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(card.textContent).toContain("“The robot picks up a red cube and places it into a blue bin.” written by Nemotron 3.5 Super VL");
    expect(within(card).getByText("Yes")).toBeTruthy();
    expect(card.textContent).toContain("Both demos move the same red cube from the table into the blue bin");
    expect(card.textContent).toContain("Judged on s1_0002_rules_m102000, a copy multiplied from this demo.");
    expect(card.textContent).toContain("Source: the 2026-10-18 labeler/judge test.");
  });

  it("lists the fixes Neaten applied, with their spans and when", () => {
    renderAt("/review2");
    const applied = screen.getByRole("list", { name: "Fixes Neaten applied" });
    const items = within(applied).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["trim 0.82–13.76 s", "remove_pause 4.50–6.52 s", "remove_pause 8.98–10.58 s", "smooth 0.00–13.76 s · strength med"]);
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(card.textContent).toContain("Applied by Neaten to s1_0002_rules on 2026-10-16 20:17 UTC.");
  });

  it("shows the earlier Nemotron run's view of the same demo honestly", () => {
    renderAt("/review2");
    const card = screen.getByRole("region", { name: "Verdict" });
    expect(card.textContent).toContain("nvidia/Nemotron-3.5-Super-VL (an earlier, sprint 3 run) looked at the same raw demo: no issues");
  });

  it("switches between the raw and perfected demos", () => {
    renderAt("/review2");
    const raw = screen.getByRole("button", { name: /Raw 13.76 s/ });
    const perfected = screen.getByRole("button", { name: /Perfected 9.32 s/ });
    perfected.click();
    return vi.waitFor(() => {
      expect(perfected.getAttribute("aria-pressed")).toBe("true");
      expect(raw.getAttribute("aria-pressed")).toBe("false");
    });
  });
});

// A live backend, mocked: the demo and its review come from GET /demos/{id} and /demos/{id}/review.
// Test fixtures only (the shapes of src/app/routers/review.py), not real data.
describe("ReviewPage2 with a live demo", () => {
  const traj = { t: [0, 1], ee_pos: [[0, 0, 0], [0, 0, 1]], ee_quat: [[1, 0, 0, 0], [1, 0, 0, 0]], gripper: [0, 0] };
  const scene = { cube_pose: { pos: [0, 0, 0], quat_wxyz: [1, 0, 0, 0] }, bin_pose: { pos: [0, 0, 0], quat_wxyz: [1, 0, 0, 0] }, robot: "franka", seed: 1 };
  const demo = { id: "human_9", source: "human", parent_id: null, trajectory: traj, scene, created_at: "2026-10-18T10:00:00Z", human_seconds: 5 };
  const review = (verdict: unknown, physics: object) => ({
    demo_id: "human_9",
    lineage: null,
    physics: { status: "failed", source: "success_check", reasons: ["dropped"], duration: 1, path_length: 1, max_contact_force: 0, settle_time: 0, detail: null, ...physics },
    fixes: { source: null, diagnosis_source: null, model_id: null, applied_to: null, applied_at: null, applied: [] },
    verdict,
    verdict_source: verdict ? "review_verdict.json" : null,
    warnings: [],
  });
  const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  function backend(r: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/demos")) return respond([demo]);
        if (url.endsWith("/demos/human_9")) return respond(demo);
        if (url.endsWith("/demos/human_9/review")) return respond(r);
        return respond({ detail: "not found" }, 404);
      }),
    );
  }
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the success check's failure in words and no verdict as not yet", async () => {
    backend(review(null, {}));
    renderAt("/review2?id=human_9");
    const card = await screen.findByRole("region", { name: "Verdict" });
    await vi.waitFor(() => expect(card.textContent).toContain("Failed ✗ dropped the cube."));
    expect(card.textContent).toContain("From the success check on the recorded signals.");
    expect(card.textContent).toContain("Not labelled by Nemotron yet.");
    expect(card.textContent).toContain("Not checked yet.");
  });

  it("says why physics is unknown", async () => {
    backend(review(null, { status: "unknown", source: null, reasons: [], duration: null, path_length: null, detail: "no passport and no recorded episode" }));
    renderAt("/review2?id=human_9");
    const card = await screen.findByRole("region", { name: "Verdict" });
    await vi.waitFor(() => expect(card.textContent).toContain("Not checked: no passport and no recorded episode."));
  });

  it("shows a stored verdict's unavailable label and match as unavailable", async () => {
    const verdict = {
      physics: { status: "failed", reasons: ["dropped"] },
      label: { status: "unavailable", task: null, object: null, destination: null, steps: [], error: "timeout" },
      match: { status: "unavailable", checks: null, reason: "timeout" },
      conflict: null,
    };
    backend(review(verdict, {}));
    renderAt("/review2?id=human_9");
    const card = await screen.findByRole("region", { name: "Verdict" });
    await vi.waitFor(() => expect(card.textContent).toContain("Nemotron label unavailable."));
    expect(card.textContent).toContain("Match unavailable.");
    expect(card.textContent).toContain("Source: review_verdict.json.");
  });
});
