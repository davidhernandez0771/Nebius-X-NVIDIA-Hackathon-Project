import { describe, expect, it } from "vitest";
import { coverAt, crossingTarget, siteModeOf } from "./crossing";
import { powerOnPlan } from "./powerOn";
import { DURATIONS } from "./tokens";

describe("siteModeOf", () => {
  it("knows which site pages are story (paper) and which are app (volt)", () => {
    expect(["/site", "/site/", "/site/results", "/design"].map(siteModeOf)).toEqual(["paper", "paper", "paper", "paper"]);
    expect(["/robots", "/robots/setup", "/review2", "/site/record-hud", "/design/app"].map(siteModeOf)).toEqual([
      "volt",
      "volt",
      "volt",
      "volt",
      "volt",
    ]);
  });

  it("leaves every other route alone", () => {
    expect(["/", "/pm/record", "/home", "/sitemap", "/robotsx"].map(siteModeOf)).toEqual([null, null, null, null, null]);
  });
});

describe("crossingTarget", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({ href, target: extra.target ?? "", download: extra.download ?? false });
  const origin = "http://localhost:5173";

  it("returns where a plain click on a story ↔ app link goes", () => {
    expect(crossingTarget(click, link(`${origin}/robots`), { origin, pathname: "/site" }, siteModeOf)).toBe("/robots");
    expect(crossingTarget(click, link(`${origin}/site/results?x=1#a`), { origin, pathname: "/review2" }, siteModeOf)).toBe("/site/results?x=1#a");
  });

  it("ignores links that stay on the same side, leave the site, or aren't plain clicks", () => {
    expect(crossingTarget(click, link(`${origin}/site/results`), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget(click, link(`${origin}/pm/record`), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget(click, link("https://github.com/x"), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget({ ...click, metaKey: true }, link(`${origin}/robots`), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget({ ...click, button: 1 }, link(`${origin}/robots`), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget(click, link(`${origin}/robots`, { target: "_blank" }), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget(click, link(`${origin}/robots`, { download: true }), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
    expect(crossingTarget({ ...click, defaultPrevented: true }, link(`${origin}/robots`), { origin, pathname: "/site" }, siteModeOf)).toBeNull();
  });
});

describe("coverAt", () => {
  const cells = [
    { d: 0, j: 0 },
    { d: 0.5, j: 0.5 },
    { d: 1, j: 1 },
  ];
  const plan = powerOnPlan(false);
  const cover = plan.find((s) => s.phase === "cover")!;
  const reveal = plan.find((s) => s.phase === "reveal")!;
  const coverEnd = cover.at + (cover.phase === "cover" ? cover.duration : 0);

  it("is empty at the start, and every cell is full once the cover has grown", () => {
    for (const c of cells) {
      expect(coverAt(0, c, c)).toBe(0);
      expect(coverAt(coverEnd, c, c)).toBe(1);
      expect(coverAt(reveal.at, c, c)).toBe(1);
    }
  });

  it("grows outward from the click: near cells fill first", () => {
    const t = coverEnd * 0.5;
    expect(coverAt(t, cells[0], cells[0])).toBeGreaterThan(coverAt(t, cells[2], cells[2]));
  });

  it("is empty again when the crossing is done, and never outside 0–1", () => {
    for (const c of cells) {
      expect(coverAt(DURATIONS.power, c, c)).toBe(0);
      for (let t = 0; t <= DURATIONS.power; t += 10) {
        const v = coverAt(t, c, c);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
