import { describe, expect, it } from "vitest";
import { CLIMB, TEACHER } from "../results/proofData";
import { FALLBACK, STAGE_IDS, loopLine, parseFlow, rateText } from "./model";

describe("the static fallback", () => {
  it("has every stage, in the page's order, with a metric and a link", () => {
    expect(FALLBACK.stages.map((s) => s.id)).toEqual(STAGE_IDS);
    for (const s of FALLBACK.stages) {
      expect(s.metric.headline).toBeTruthy();
      expect(s.link.startsWith("/")).toBe(true);
    }
    expect(FALLBACK.loop.status).toBe("none");
  });

  it("takes its numbers from the Results page's own data", () => {
    const by = Object.fromEntries(FALLBACK.stages.map((s) => [s.id, s]));
    const v2 = CLIMB.find((c) => c.key === "v2")!;
    expect(by.train.metric.after).toEqual({ k: v2.k, n: v2.n, ci: v2.ci });
    expect(by.teach.metric.after?.k).toBe(TEACHER.final.withDemos.k);
    expect(by.multiply.metric.before?.k).toBe(3);
    expect(by.multiply.metric.after?.k).toBe(17);
  });
});

describe("parseFlow", () => {
  it("accepts the endpoint's shape", () => {
    const parsed = parseFlow(JSON.parse(JSON.stringify(FALLBACK)));
    expect(parsed.stages).toHaveLength(STAGE_IDS.length);
  });

  it("refuses a body without every stage", () => {
    expect(() => parseFlow({ stages: [], loop: { status: "none" } })).toThrow();
    expect(() => parseFlow(null)).toThrow();
  });

  it("drops unknown loop statuses to none, and links that are not site paths", () => {
    const body = JSON.parse(JSON.stringify(FALLBACK));
    body.loop = { status: "hacked" };
    body.stages[0].link = "javascript:alert(1)";
    const parsed = parseFlow(body);
    expect(parsed.loop.status).toBe("none");
    expect(parsed.stages[0].link).toBe("/flow");
  });
});

describe("text", () => {
  it("formats a rate", () => {
    expect(rateText({ k: 30, n: 40, ci: [0.598, 0.858] })).toBe("30/40");
  });

  it("says where the loop is", () => {
    expect(loopLine({ status: "none" })).toMatch(/not run yet/i);
    expect(loopLine({ status: "running", name: "loop1", current: "train_recipe", stages: [], seeds: [5680, 5719], result: null })).toMatch(/training the recipe arm/i);
  });
});
