// site-bugs (2026-10-26): on a phone (390 px) the twin pane's header ("workspace · robot twin", the wrist dial, the
// soft floor box and the REPLAY/LIVE tag) is one nowrap row wider than the pane, so the tag ran past the pane's right
// edge. The rule, held over the stylesheet: below 960 px the header wraps (the tools drop under the label) and the
// 3D view starts under both lines. (jsdom has no layout; the SwiftShader shots in the site-bugs note show it.)
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

describe("the twin pane's header on a narrow screen", () => {
  it("wraps its tools under the label and moves the 3D view down to clear both lines", async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    const css = fs.readFileSync(`${cwd()}/src/site/record/record-hologram.css`, "utf8").replace(/\r\n/g, "\n");
    const narrow = media(css, "max-width: 960px");
    expect(narrow).toMatch(/\.rg-hd--twin\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(narrow).toMatch(/\.rg-hd--twin \.rg-hd__tools\s*\{[^}]*flex-wrap:\s*wrap/);
    // the 3D view's top inset (26px for one line on wide screens) clears a second header line
    const inset = narrow.match(/\.rg-twin3d\s*\{[^}]*inset:\s*(\d+)px/);
    expect(inset && Number(inset[1])).toBeGreaterThanOrEqual(44);
  });
});
