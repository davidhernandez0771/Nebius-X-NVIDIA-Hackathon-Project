// GLSL's pow(x, y) is undefined for x < 0, and D3D (Chrome on Windows) returns NaN there, which the bloom smears into
// flickering dashes. Every pow in the opening's shaders guards its base (a rim's 1 - dot(n, v) or a sine's .5 + .5 sin
// can dip a hair below 0, an interpolated uv a hair past 1). The rule, held over the sources: the first argument of
// every GLSL pow starts with max(, clamp( or abs(.
import { describe, expect, it } from "vitest";

type Fs = { readFileSync(p: string, enc: string): string; readdirSync(p: string): string[] };
const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

function firstArg(src: string, at: number): string {
  let depth = 0;
  for (let k = at; k < src.length; k++) {
    const c = src[k];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return src.slice(at, k);
  }
  return src.slice(at);
}

describe("the opening's shaders never take pow of a negative base", () => {
  it("guards the first argument of every GLSL pow in the intro and the descent", async () => {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    const bad: string[] = [];
    let seen = 0;
    for (const dir of ["src/world/stations/intro", "src/world/stations/descent"]) {
      for (const f of fs.readdirSync(`${cwd()}/${dir}`)) {
        if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
        const src = fs.readFileSync(`${cwd()}/${dir}/${f}`, "utf8");
        for (let i = src.indexOf("pow("); i >= 0; i = src.indexOf("pow(", i + 4)) {
          if (src.slice(i - 5, i) === "Math.") continue;
          seen++;
          const arg = firstArg(src, i + 4).trim();
          if (!/^(max|clamp|abs)\(/.test(arg)) bad.push(`${f}: pow(${arg}, …)`);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});
