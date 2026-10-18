// The design-system spec's contrast table, re-checked from the CSS itself, plus the motion
// tokens: the CSS custom properties and the anime.js numbers in motion/tokens.ts must agree.
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { DURATIONS, EASINGS, STAGGER } from "./motion/tokens";

// Vitest blanks CSS imports (even `?raw`), so read the file itself. The module name is built at
// runtime because the app's tsconfig has no Node types.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readFileSync(path: string, encoding: "utf-8"): string;
};
// Vitest runs from web/ (npm --prefix web test, or npx vitest in web/).
const css = fs.readFileSync("src/sant/tokens.css", "utf-8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const body = css.slice(start, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--(sant-[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const modes = { paper: block('[data-mode="paper"]'), volt: block('[data-mode="volt"]') };

const TEXT = 4.5;
const UI = 3;
const pairs: [string, string, number][] = [
  ["text", "bg", TEXT],
  ["text", "surface", TEXT],
  ["text", "surface-2", TEXT],
  ["muted", "bg", TEXT],
  ["muted", "surface", TEXT],
  ["muted", "surface-2", TEXT],
  ["accent", "bg", TEXT],
  ["accent", "surface", TEXT],
  ["accent-ink", "accent-soft", TEXT],
  ["on-accent", "accent", TEXT],
  ["issue", "bg", TEXT],
  ["issue", "surface", TEXT],
  ["issue", "issue-soft", TEXT],
  ["violet", "bg", TEXT],
  ["violet", "violet-soft", TEXT],
  ["danger", "bg", TEXT],
  ["control", "bg", UI],
  ["control", "surface", UI],
  ["control", "surface-2", UI],
];

describe.each(Object.entries(modes))("%s mode colours", (_mode, vars) => {
  it.each(pairs)("%s on %s is at least %d:1", (fg, bg, min) => {
    const a = vars[`sant-${fg}`];
    const b = vars[`sant-${bg}`];
    expect(a, `--sant-${fg}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(b, `--sant-${bg}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(contrast(a, b)).toBeGreaterThanOrEqual(min);
  });
});

describe("the user's fixed palette", () => {
  it("uses the brief's Volt and paper values", () => {
    expect(modes.volt).toMatchObject({
      "sant-bg": "#07090C",
      "sant-text": "#E6EDF3",
      "sant-muted": "#8B95A1",
      "sant-accent": "#19F5C2",
      "sant-issue": "#FFB000",
      "sant-violet": "#A78BFA",
    });
    expect(modes.paper).toMatchObject({ "sant-bg": "#F4F1EA", "sant-text": "#111111", "sant-muted": "#6B6760" });
  });

  it("never uses NVIDIA green", () => {
    expect(css.toUpperCase()).not.toContain("76B900");
  });
});

describe("motion tokens", () => {
  const root = block(":root");

  it("match between CSS and anime.js: durations", () => {
    for (const [name, ms] of Object.entries(DURATIONS)) expect(root[`sant-dur-${name}`], name).toBe(`${ms}ms`);
  });

  it("match between CSS and anime.js: easings", () => {
    for (const [name, b] of Object.entries(EASINGS)) expect(root[`sant-ease-${name}`], name).toBe(`cubic-bezier(${b.join(", ")})`);
  });

  it("match between CSS and anime.js: staggers", () => {
    for (const [name, ms] of Object.entries(STAGGER)) expect(root[`sant-stagger-${name}`], name).toBe(`${ms}ms`);
  });

  it("collapse every duration to 0 when motion is reduced", () => {
    const reduced = block('[data-motion="reduced"]');
    for (const name of Object.keys(DURATIONS)) expect(reduced[`sant-dur-${name}`], name).toBe("0ms");
  });
});
