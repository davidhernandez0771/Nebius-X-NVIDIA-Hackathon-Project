// The way-back bar sits outside the places' panels (top left, under the SANT mark), inside the overlay layer that
// lets clicks through to the 3D (world.css: .world-overlays and .world-station are pointer-events: none). Only the
// panels' controls opt back in (.world-panel :is(button, …)). Without its own opt-in the bar drew, but a real click
// went through it to the canvas: "Back to room" did nothing in every place (the user, 2026-10-26). jsdom has no
// layout or hit-testing, so this reads the rule itself.
import { beforeAll, describe, expect, it } from "vitest";

type Fs = { readFileSync(p: string, enc: string): string };
const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
let css = "";

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  expect(at).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("the way-back bar takes clicks", () => {
  beforeAll(async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    css = fs.readFileSync(`${cwd()}/src/world/ui/ui.css`, "utf8").replace(/\r\n/g, "\n");
  });

  it("opts back into pointer events inside the click-through overlay layer", () => {
    expect(rule(".world-stationbar")).toMatch(/pointer-events:\s*auto/);
  });
});
