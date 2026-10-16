// Page states (plan sprint 3, Review Focus 5): an empty store or a backend
// that is down shows a clear message, never a blank screen.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import ReviewPage from "./ReviewPage";
import { demo, down, renderAt, stubBackend } from "../testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Review page", () => {
  it("invites a first recording when the store is empty", async () => {
    stubBackend({ "GET /demos": { status: 200, body: [] } });
    renderAt("/pm/review", <ReviewPage />, "/pm/review");
    expect(await screen.findByText("No demos yet")).toBeTruthy();
  });

  it("says the backend is unreachable", async () => {
    stubBackend({ "GET /demos": down });
    renderAt("/pm/review", <ReviewPage />, "/pm/review");
    expect(await screen.findByText(/can't reach the backend/i)).toBeTruthy();
  });

  it("shows the backend's message for a demo id that doesn't exist", async () => {
    stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/nope": { status: 404, body: { detail: "demo 'nope' not found" } },
    });
    renderAt("/pm/review?id=nope", <ReviewPage />, "/pm/review");
    expect(await screen.findByText("demo 'nope' not found")).toBeTruthy();
  });

  it("shows an undiagnosed demo with its strip empty and Perfect available", async () => {
    stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/h1": { status: 200, body: demo("h1", "human") },
      "GET /demos/h1/diagnosis": { status: 404, body: { detail: "demo 'h1' has no diagnosis yet" } },
    });
    renderAt("/pm/review?id=h1", <ReviewPage />, "/pm/review");
    expect(await screen.findByText(/not diagnosed yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Perfect this demo" })).toBeTruthy();
  });

  it("runs a labelled mock job when the backend has no perfect route", async () => {
    stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/h1": { status: 200, body: demo("h1", "human") },
      "GET /demos/h1/diagnosis": { status: 404, body: { detail: "demo 'h1' has no diagnosis yet" } },
    });
    renderAt("/pm/review?id=h1", <ReviewPage pollIntervalMs={0} />, "/pm/review");
    fireEvent.click(await screen.findByRole("button", { name: "Perfect this demo" }));
    expect(await screen.findByText(/mock job/i)).toBeTruthy();
    expect(await screen.findByText("Finished")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the perfected demo" })).toBeNull();
  });

  it("polls a real job to the end and links the repaired demo", async () => {
    const calls = stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/h1": { status: 200, body: demo("h1", "human") },
      "GET /demos/h1/diagnosis": { status: 404, body: { detail: "demo 'h1' has no diagnosis yet" } },
      "POST /demos/h1/perfect": { status: 202, body: { job_id: "j9" } },
      "GET /jobs/j9": [
        { status: 200, body: { id: "j9", status: "running" } },
        { status: 200, body: { id: "j9", status: "succeeded", result: { repaired_demo_id: "r7" } } },
      ],
    });
    renderAt("/pm/review?id=h1", <ReviewPage pollIntervalMs={0} />, "/pm/review");
    fireEvent.click(await screen.findByRole("button", { name: "Perfect this demo" }));
    const link = await screen.findByRole("link", { name: "Open the perfected demo" });
    expect(link.getAttribute("href")).toBe("/pm/review?id=r7");
    expect(calls.filter((c) => c === "GET /jobs/j9").length).toBe(2);
    expect(screen.queryByText(/mock job/i)).toBeNull();
  });

  it("tells the user to start the sim worker on 503", async () => {
    stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/h1": { status: 200, body: demo("h1", "human") },
      "GET /demos/h1/diagnosis": { status: 404, body: { detail: "demo 'h1' has no diagnosis yet" } },
      "POST /demos/h1/perfect": { status: 503, body: { detail: "sim worker not running at http://127.0.0.1:8770" } },
    });
    renderAt("/pm/review?id=h1", <ReviewPage pollIntervalMs={0} />, "/pm/review");
    fireEvent.click(await screen.findByRole("button", { name: "Perfect this demo" }));
    expect(await screen.findByText(/sim worker isn't running/i)).toBeTruthy();
  });
  it("lists a diagnosed demo's issues, repairs and the claims the gate dropped", async () => {
    stubBackend({
      "GET /demos": { status: 200, body: [demo("h1", "human")] },
      "GET /demos/h1": { status: 200, body: demo("h1", "human") },
      "GET /demos/h1/diagnosis": {
        status: 200,
        body: {
          source: "nemotron",
          model_id: "nvidia/Nemotron-3.5-Super-VL",
          gated: ["rim_contact 1.0-1.5 s: no arm-bin contact in those windows"],
          diagnosis: {
            segments: [{ name: "approach", t0: 0, t1: 1 }, { name: "grasp", t0: 1, t1: 2 }],
            issues: [{ type: "pause", t0: 0.5, t1: 1, evidence: "speed under 0.01 m/s" }],
            repairs: [{ op: "remove_pause", t0: 0.5, t1: 1 }],
            decision: "repair",
            label: "pick the cube and place it in the bin",
          },
        },
      },
    });
    renderAt("/pm/review?id=h1", <ReviewPage />, "/pm/review");
    expect(await screen.findByText("pause")).toBeTruthy();
    expect(screen.getByText("remove_pause")).toBeTruthy();
    expect(screen.getByText("rim_contact 1.0-1.5 s: no arm-bin contact in those windows")).toBeTruthy();
    expect(screen.getByText("Decision: repair")).toBeTruthy();
  });
});
