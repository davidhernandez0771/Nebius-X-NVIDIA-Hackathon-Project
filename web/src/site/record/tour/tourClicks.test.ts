// The tour sits over the page in a full-screen layer that lets clicks through (pointer-events: none). On 10-26 a
// button outside a panel drew fine but real clicks went through it ("Back to room" did nothing). So every tour control
// opts back in with its own rule, and the layer, the rings and the line let the page's clicks through. jsdom has no
// hit-testing, so this reads the rules; web/scripts/record-tour-clicks.mjs clicks each control with real CDP mouse
// events after an elementFromPoint check. (Mirrors world/guide/guideClicks.test.ts.)
import { beforeAll, describe, expect, it } from "vitest";

type Fs = { readFileSync(p: string, enc: string): string };
const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
let css = "";

/** The declarations of every top-level rule whose selector list has `selector` in it, joined. */
function rules(selector: string): string {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const sels = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  expect(out.length, `no rule for ${selector}`).toBeGreaterThan(0);
  return out.join("\n");
}

describe("the /record tour's controls take real clicks", () => {
  beforeAll(async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    css = fs.readFileSync(`${cwd()}/src/site/record/tour/record-tour.css`, "utf8").replace(/\r\n/g, "\n");
  });

  it.each([".rg-tour__card", ".rg .rg-tour__btn", ".rg .rg-tour__skip", ".rg .rg-tour-btn"])("%s opts back into pointer events", (sel) => {
    expect(rules(sel)).toMatch(/pointer-events:\s*auto/);
  });

  it("the full-screen layer, the rings and the line let the page's clicks through", () => {
    expect(rules(".rg-tour")).toMatch(/pointer-events:\s*none/);
    expect(rules(".rg-tour__ring")).toMatch(/pointer-events:\s*none/);
    expect(rules(".rg-tour__wire")).toMatch(/pointer-events:\s*none/);
  });

  it("sits over the page's panes and drawers", () => {
    expect(Number(/z-index:\s*(\d+)/.exec(rules(".rg-tour"))?.[1])).toBeGreaterThanOrEqual(60);
  });

  it("reduced motion: nothing slides or pulses", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("}\n}", at));
    for (const sel of [".rg-tour__card", ".rg-tour__ring"]) expect(block).toContain(sel);
    expect(block).toMatch(/animation:\s*none/);
    expect(css).toMatch(/\[data-motion="reduced"\] :is\(\.rg-tour__card, \.rg-tour__ring\) \{\s*animation: none;/);
  });
});
