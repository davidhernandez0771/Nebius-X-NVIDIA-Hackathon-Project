import { describe, expect, it } from "vitest";
import { ARMS, COMPARISONS, NOTES, REPORT_CARDS, cite, type Source } from "./facts";
import { wilson } from "./stats";

const one = (x: number) => (Math.round(x * 1000) / 10).toFixed(1);

function sources(value: unknown, found: Source[] = []): Source[] {
  if (Array.isArray(value)) value.forEach((v) => sources(v, found));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.note === "string" && typeof o.lines === "string") found.push(o as unknown as Source);
    else Object.values(o).forEach((v) => sources(v, found));
  }
  return found;
}

describe("the arms", () => {
  it("are 0, 100 and 300 copies, in that order", () => {
    expect(ARMS.map((a) => a.copies)).toEqual([0, 100, 300]);
  });

  it("have outcome strings that add up to the counts in the note", () => {
    for (const a of ARMS) {
      expect(a.outcomes).toMatch(/^[01]+$/);
      expect(a.outcomes.length).toBe(a.n);
      expect([...a.outcomes].filter((c) => c === "1").length).toBe(a.k);
    }
    expect(ARMS.map((a) => `${a.k}/${a.n}`)).toEqual(["3/40", "17/40", "16/40"]);
  });

  it("print the CI the note printed, and it is the Wilson CI of k/n", () => {
    for (const a of ARMS) {
      const [lo, hi] = wilson(a.k, a.n);
      expect(a.ci.text).toBe(`${one(lo)}–${one(hi)}%`);
    }
  });

  it("count drops among failures, never more than the failures", () => {
    for (const a of ARMS) expect(a.drops.of).toBe(a.n - a.k);
    expect(ARMS.map((a) => `${a.drops.k} of ${a.drops.of}`)).toEqual(["15 of 37", "22 of 23", "23 of 24"]);
  });
});

describe("sources", () => {
  const all = sources({ ARMS, COMPARISONS, REPORT_CARDS });

  it("are on every fact", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) {
      expect(Object.keys(NOTES)).toContain(s.note);
      expect(s.lines).toMatch(/^\d+(–\d+)?(, \d+(–\d+)?)*$/);
    }
  });

  it("read as a note and its lines", () => {
    expect(cite({ note: "t3", lines: "1156" })).toBe("T3 status note, line 1156");
    expect(cite({ note: "t3", lines: "1171–1173" })).toBe("T3 status note, lines 1171–1173");
    expect(cite({ note: "t2", lines: "302–303, 368" })).toBe("T2 status note, lines 302–303, 368");
  });
});

describe("report cards", () => {
  it("give every failure reason a count no bigger than its total", () => {
    for (const card of REPORT_CARDS)
      for (const r of card.failures?.reasons ?? []) expect(r.k).toBeLessThanOrEqual(card.failures!.of);
  });

  it("say pending instead of inventing a value", () => {
    const yours = REPORT_CARDS.find((c) => c.key === "yours")!;
    expect([yours.copies, yours.policy, yours.failures, yours.reach]).toEqual([null, null, null, null]);
  });

  it("compare copies on the same seeds, and say why a policy is missing", () => {
    const [franka, openarm] = REPORT_CARDS;
    expect(`${franka.copies!.k}/${franka.copies!.n}`).toBe("27/30");
    expect(`${openarm.copies!.k}/${openarm.copies!.n}`).toBe("0/30");
    expect(franka.copies!.what).toBe(openarm.copies!.what);
    expect(openarm.policy).toBeNull();
    expect(openarm.policyNote).toMatch(/no copies passed/);
  });
});
