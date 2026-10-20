import { describe, expect, it } from "vitest";
import { RESULTS, fact, formatP } from "../../../site/results/data";
import { PROOF } from "./proof";

const arm = (id: string, key: string) => RESULTS.experiments.find((e) => e.id === id)!.groups.flatMap((g) => g.arms).find((a) => a.key === key)!;

describe("the intro's proof numbers", () => {
  it("are the Results page's numbers", () => {
    expect(PROOF.raw).toBe(`${arm("multiply", "raw_10_30k").k}/${arm("multiply", "raw_10_30k").n}`);
    expect(PROOF.multiplied).toBe(`${arm("multiply", "raw_multiply_10_30k").k}/${arm("multiply", "raw_multiply_10_30k").n}`);
    const p = RESULTS.experiments.find((e) => e.id === "multiply")!.groups[0].comparisons.find((c) => c.b === "raw_multiply_10_30k")!.p!;
    expect(PROOF.p).toBe(formatP(p));
    expect(PROOF.webcam).toEqual({
      demos: arm("webcam", "webcam_raw").n,
      passed: `${arm("webcam", "webcam_raw").k}/${arm("webcam", "webcam_raw").n}`,
      repaired: arm("webcam", "webcam_repaired").k,
      copies: arm("webcam", "webcam_copies").k,
    });
    expect(PROOF.labels).toBe(`${arm("nemotron", "labeler_nemotron").k}/${arm("nemotron", "labeler_nemotron").n}`);
    expect([PROOF.pressed, PROOF.peak]).toEqual([fact("webcam_pressed").text, fact("webcam_peak_n").text]);
  });

  it("read today's values", () => {
    expect(PROOF).toMatchObject({ raw: "3/40", multiplied: "17/40", p: "0.0005", labels: "40/40", pressed: "9/10", peak: "927 N" });
    expect(PROOF.webcam).toEqual({ demos: 10, passed: "0/10", repaired: 3, copies: 24 });
  });
});
