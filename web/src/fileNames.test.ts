// Windows and macOS ignore letter case in file names. An import like "./Detail" resolves by trying
// extensions in order (.ts before .tsx), so with Detail.tsx and detail.ts side by side it loads the
// wrong file there and the site crashes, while Linux (and CI) never notice. Keep module names in a
// folder distinct ignoring case.
import { describe, expect, it } from "vitest";

// Every module under src (lazy: only the paths are used, nothing is imported).
const FILES = Object.keys(import.meta.glob("./**/*.{ts,tsx,js,jsx}"));

export function collisions(paths: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const p of paths) {
    const module = p.replace(/\.[jt]sx?$/, "");
    const key = module.toLowerCase();
    const other = seen.get(key);
    if (other !== undefined && other !== module) out.push(`${other} vs ${p}`);
    else seen.set(key, module);
  }
  return out;
}

describe("file names", () => {
  it("catches a pair that only differs by case", () => {
    expect(collisions(["./a/Detail.tsx", "./a/detail.ts", "./a/Dock.tsx"])).toEqual(["./a/Detail vs ./a/detail.ts"]);
  });

  it("has no two modules in one folder whose names differ only by letter case", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(collisions(FILES)).toEqual([]);
  });
});
