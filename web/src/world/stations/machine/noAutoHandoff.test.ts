// site-nav (2026-10-26, the user): the projection never hands off to Record on its own. Plug in used to carry on
// by itself (plug.autoplay): the machine's scene opened the zoom once the cartridge was in, and the zoom's end opened
// Record. Now only a click opens the zoom ("Into the projection →", machine/index.tsx) or the page ("Open …").
import { describe, expect, it } from "vitest";
import { plug, sendToMachine } from "../../scene/plug";

type Fs = { readFileSync(p: string, enc: string): string };
const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

describe("Plug in stops at the projection", () => {
  it("the plug has no carry-on: sending a cartridge only plugs it in", () => {
    sendToMachine(3);
    expect(plug.slot).toBe(3);
    expect("autoplay" in plug).toBe(false);
  });

  it("the machine's scene never opens the zoom by itself", async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    const src = fs.readFileSync(`${cwd()}/src/world/stations/machine/Scene.tsx`, "utf8");
    expect(src).not.toMatch(/goTo\(\s*["']zoom["']\s*\)/);
  });
});
