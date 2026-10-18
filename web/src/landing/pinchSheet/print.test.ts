import { describe, expect, it } from "vitest";
import { PAPER, printLayout, printSvg, drawPrint } from "./print";

describe("printLayout: what is printed on the sheet", () => {
  const L = printLayout(1024, 640);

  it("prints SANT in ink as the wordmark, centred, large and widely tracked", () => {
    const word = L.runs.find((r) => r.role === "wordmark")!;
    expect(word.text).toBe("SANT");
    expect(word.color).toBe(PAPER.ink);
    expect(word.color).toBe("#111111");
    expect(word.x).toBe(512);
    expect(word.size).toBeGreaterThan(640 * 0.2);
    expect(word.tracking).toBeGreaterThan(0.1);
  });

  it("sets the brand line under it in the muted ink, smaller", () => {
    const word = L.runs.find((r) => r.role === "wordmark")!;
    const line = L.runs.find((r) => r.role === "line")!;
    expect(line.text).toBe("Simulate · Augment · Neaten · Train");
    expect(line.color).toBe(PAPER.muted);
    expect(line.y).toBeGreaterThan(word.y);
    expect(line.size).toBeLessThan(word.size / 4);
  });

  it("keeps everything inside the sheet, inside the stitched hem", () => {
    expect(L.hem.inset).toBeGreaterThan(0);
    for (const r of L.runs) {
      expect(r.y).toBeLessThan(640 - L.hem.inset);
      expect(r.y - r.size).toBeGreaterThan(L.hem.inset);
    }
  });

  it("scales with the texture size", () => {
    const big = printLayout(2048, 1280);
    expect(big.runs[0].size).toBeCloseTo(2 * L.runs[0].size);
    expect(big.hem.inset).toBeCloseTo(2 * L.hem.inset);
  });

  it("never prints the teal: teal is kept for the live pinch", () => {
    const colors = [L.ground, L.hem.color, L.weave.color, ...L.runs.map((r) => r.color)];
    expect(colors).not.toContain(PAPER.accent);
  });
});

describe("printSvg: the still version", () => {
  it("is an SVG of the same print, with the wordmark as real text", () => {
    const svg = printSvg(1024, 640);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 1024 640"/);
    expect(svg).toContain(">SANT</text>");
    expect(svg).toContain("Simulate · Augment · Neaten · Train");
    expect(svg).toContain('fill="#111111"');
    expect(svg).toContain(`fill="${PAPER.sheet}"`);
  });
});

describe("drawPrint: the texture version", () => {
  it("fills the sheet, draws the hem and the two text runs, one letter at a time for the tracking", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      globalAlpha: 1,
      fillRect: () => calls.push("fillRect"),
      strokeRect: () => calls.push("strokeRect"),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => calls.push("stroke"),
      setLineDash: () => {},
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillText: (t: string) => calls.push(`text:${t}`),
      save: () => {},
      restore: () => {},
    };
    drawPrint(ctx as unknown as CanvasRenderingContext2D, 1024, 640);
    expect(calls[0]).toBe("fillRect");
    expect(calls).toContain("strokeRect");
    expect(calls.filter((c) => c.startsWith("text:")).slice(0, 4)).toEqual(["text:S", "text:A", "text:N", "text:T"]);
    expect(calls).toContain("text:Simulate · Augment · Neaten · Train");
  });
});
