import { describe, expect, it } from "vitest";
import { applyEvent, initialFeed, parseEvent, STAGES, type FeedState } from "./liveFeed";

const run = (events: Record<string, unknown>[], from: FeedState = initialFeed()) => events.reduce<FeedState>((s, e) => applyEvent(s, parseEvent(JSON.stringify(e))!), from);

const hello = { type: "hello", name: "mouse20261020", ids: ["h1", "h2"], input: "mouse", variants: 2 };

describe("the live feed", () => {
  it("starts with every stage waiting and every demo pending", () => {
    const s = run([hello]);
    expect(STAGES.map((st) => st.id)).toEqual(["physics", "repair", "multiply", "train", "eval"]);
    expect(Object.values(s.stages)).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
    expect(s.ids).toEqual(["h1", "h2"]);
    expect(s.demos.h1).toEqual({});
  });

  it("lights the physics check, then marks it done once every demo has a verdict", () => {
    let s = run([hello, { type: "physics", at: "15:05:23", id: "h1", success: true, reasons: [] }]);
    expect(s.stages.physics).toBe("running");
    expect(s.demos.h1.physics).toEqual({ success: true, reasons: [] });
    s = run([{ type: "physics", at: "15:05:36", id: "h2", success: false, reasons: ["collision"] }], s);
    expect(s.stages.physics).toBe("done");
    expect(s.lastAt).toBe("15:05:36");
  });

  it("keeps the pipeline in order: a later stage starting finishes the ones before it", () => {
    const s = run([hello, { type: "repair", at: "1", id: "h1", status: "perfected", repairs: 2 }]);
    expect(s.stages.physics).toBe("done");
    expect(s.stages.repair).toBe("running");
    expect(s.demos.h1.repair).toEqual({ status: "perfected", repairs: 2 });
    const t = run([{ type: "stage", stage: "train", at: "2", text: "started" }], s);
    expect([t.stages.repair, t.stages.multiply, t.stages.train]).toEqual(["done", "done", "running"]);
  });

  it("pops each verified variant in, newest first, once", () => {
    const v1 = { type: "variant", id: "h1_rules_home_m3100", source: "h1", seed: 3100, success: true, reasons: [], frames: 404 };
    const v2 = { ...v1, id: "h1_rules_home_m3101", seed: 3101, success: false, reasons: ["dropped"] };
    const s = run([hello, v1, v2, v1]);
    expect(s.stages.multiply).toBe("running");
    expect(s.variants.map((v) => v.id)).toEqual(["h1_rules_home_m3101", "h1_rules_home_m3100"]);
    expect(s.variants[0]).toMatchObject({ source: "h1", seed: 3101, success: false, reasons: ["dropped"], frames: 404 });
    const m = run([{ type: "multiply", at: "3", id: "h1", k: 1, n: 2 }], s);
    expect(m.demos.h1.multiply).toEqual({ k: 1, n: 2 });
  });

  it("ends with the training loss and the evaluation", () => {
    const s = run([
      hello,
      { type: "stage", stage: "grid", at: "1", text: "raw 10 episodes" },
      { type: "train", at: "2", run: "r", cells: [{ cell: "perfected_multiply_10", loss: 0.065 }] },
      { type: "stage", stage: "eval", at: "3", text: "started" },
      { type: "eval", at: "4", cells: [{ cell: "perfected_multiply_10", k: 3, n: 40 }] },
      { type: "done", at: "4", through: "results" },
      { type: "end" },
    ]);
    expect(Object.values(s.stages)).toEqual(["done", "done", "done", "done", "done"]);
    expect(s.train).toEqual([{ cell: "perfected_multiply_10", loss: 0.065 }]);
    expect(s.evals).toEqual([{ cell: "perfected_multiply_10", k: 3, n: 40 }]);
    expect(s.ended).toBe(true);
  });

  it("ignores what it can't read", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent(JSON.stringify({ no: "type" }))).toBeNull();
    const s = run([hello]);
    expect(applyEvent(s, { type: "something_else" } as never)).toBe(s);
  });
});
