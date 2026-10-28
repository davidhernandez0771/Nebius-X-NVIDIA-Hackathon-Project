// site-nav (2026-10-26): on a phone (390 px) the keyboard/mouse drive panel overflowed the camera pane, which keeps its
// 4:3 shape below 960 px: the key table ran under "Start keyboard" (pinned to the pane's bottom) and the key hint.
// The rule, held over the stylesheet: below 960 px a pane that drives grows with its panel, and the start button
// sits in the flow under it. (jsdom has no layout; the SwiftShader shots in the site-nav note show it.)
import { describe, expect, it } from "vitest";

type Fs = { readFileSync(p: string, enc: string): string };
const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

/** The body of the first @media block whose query contains `query`. */
function media(css: string, query: string): string {
  const at = css.indexOf(`@media (${query})`);
  if (at < 0) return "";
  let depth = 0;
  for (let k = css.indexOf("{", at); k < css.length; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}" && --depth === 0) return css.slice(at, k);
  }
  return "";
}

describe("the drive panel on a narrow screen", () => {
  it("grows the camera pane with the panel and puts Start in the flow", async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    const css = fs.readFileSync(`${cwd()}/src/site/record/record-hologram.css`, "utf8").replace(/\r\n/g, "\n");
    const narrow = media(css, "max-width: 960px");
    expect(narrow).toMatch(/\.rg-cam:has\(\.rg-drive\)\s*\{[^}]*aspect-ratio:\s*auto/);
    expect(narrow).toMatch(/\.rg-cam:has\(\.rg-drive\) \.rg-cam__media\s*\{[^}]*position:\s*relative/);
    expect(narrow).toMatch(/\.rg-drive__start\s*\{[^}]*position:\s*static/);
  });
});
