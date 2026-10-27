// The guide sits over the 3D, and the world's overlay layers let clicks through to the canvas (pointer-events: none).
// On 10-26 a button outside a panel drew fine but real clicks went through it ("Back to room" did nothing:
// ui/stationbarClicks.test.ts). So every guide control opts back in with its own rule, and the guide's full-screen
// layer itself lets the room's clicks through. jsdom has no hit-testing, so this reads the rules; the CDP run with
// real mouse events (docs/superpowers/notes/2026-10-27-tour.md) checks elementFromPoint on each control too.
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

describe("the guide's controls take real clicks", () => {
  beforeAll(async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    css = fs.readFileSync(`${cwd()}/src/world/guide/guide.css`, "utf8").replace(/\r\n/g, "\n");
  });

  it.each([".world-guide__card", ".world-guide-offer", ".sant.world .world-guide-help", ".sant.world .world-guide__btn", ".sant.world .world-guide__skip", ".sant.world .world-guide__link"])(
    "%s opts back into pointer events",
    (sel) => {
      expect(rules(sel)).toMatch(/pointer-events:\s*auto/);
    },
  );

  it("the full-screen layer, the ring and the line let the room's clicks through", () => {
    expect(rules(".world-guide")).toMatch(/pointer-events:\s*none/);
    expect(rules(".world-guide__ring")).toMatch(/pointer-events:\s*none/);
    expect(rules(".world-guide__wire")).toMatch(/pointer-events:\s*none/);
  });

  it("reduced motion: nothing slides or pulses", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("}\n}", at));
    for (const sel of [".world-guide__card", ".world-guide-offer", ".world-guide__ring"]) expect(block).toContain(sel);
    expect(block).toMatch(/animation:\s*none/);
    expect(css).toMatch(/\[data-motion-world="reduced"\] :is\(\.world-guide__card, \.world-guide-offer, \.world-guide__ring\) \{\s*animation: none;/);
  });
});
