// The page's own icon and meta: the SANT favicon (the user's sant-favicon.svg) with PNG fallbacks drawn
// from it (web/scripts/brand-icons.mjs), named "SANT".
import { describe, expect, it } from "vitest";
import FAVICON from "../public/favicon.svg?raw";
import HTML from "../index.html?raw";

// The PNGs are binary: read the files themselves. The module name is built at runtime because the
// app's tsconfig has no Node types (as in sant/tokens.test.ts). Vitest runs from web/.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readFileSync(path: string): Uint8Array;
  existsSync(path: string): boolean;
};
const html = HTML;

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = fs.readFileSync(path);
  expect(String.fromCharCode(b[1], b[2], b[3])).toBe("PNG");
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return [u32(16), u32(20)];
}

describe("the page's icon", () => {
  it("is the SANT favicon SVG, with 32 and 16 px PNGs for browsers without SVG icons, and a home-screen icon", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />');
    expect(html).toContain('<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).not.toContain('href="data:,"');
  });

  it("ships the files at their sizes", () => {
    expect(fs.existsSync("public/favicon.svg")).toBe(true);
    expect(pngSize("public/favicon-32.png")).toEqual([32, 32]);
    expect(pngSize("public/favicon-16.png")).toEqual([16, 16]);
    expect(pngSize("public/apple-touch-icon.png")).toEqual([180, 180]);
  });

  it("draws the open-corner tesseract on the dark rounded square", () => {
    const svg = FAVICON;
    expect(svg).toContain('rx="22" fill="#0B0E11"');
    expect(svg).toContain('stroke="#19F5C2"');
    expect(svg).toContain("38.11,-7.04 38.11,22.00 0.00,44.00");
  });

  it("names the page SANT and gives it the ground's colour", () => {
    expect(html).toContain("<title>SANT</title>");
    expect(html).toContain('<meta name="theme-color" content="#0B0E11" />');
  });
});
