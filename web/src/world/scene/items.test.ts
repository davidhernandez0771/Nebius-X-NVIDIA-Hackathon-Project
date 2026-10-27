// The cartridges' one honest sentence each (items.ts) against the results.
import { describe, expect, it } from "vitest";
import { CLIMB } from "../../site/results/proofData";
import { ITEMS } from "./items";

describe("the cartridges' sentences", () => {
  // site-bugs (2026-10-26): EVAL 40 said every policy is tested on the same 40 unseen seeds; the final test (v2,
  // 30/40) ran on fresh seeds 5400–5439, the others on 5020–5059.
  it("don't claim every policy ran on the same 40 seeds", () => {
    const seeds = new Set(CLIMB.map((s) => s.seeds));
    expect(seeds.size).toBeGreaterThan(1);
    const evalItem = ITEMS.find((i) => i.title === "EVAL 40")!;
    expect(evalItem.desc).not.toMatch(/same 40/i);
    expect(evalItem.desc).toMatch(/once/);
  });
});
