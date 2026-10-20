// The contact glow's force -> colour mapping and the force bar's scale.

import { describe, expect, it } from "vitest";
import { BAR_MAX_N, COLLISION_MARK, COLLISION_N, GLOW, TOUCH_N, barFraction, bodyLabel, contactGlow, contactLevel, contactText } from "./contact";

describe("contactGlow", () => {
  it("nothing below a touch, amber from a touch up to 5 N, red over 5 N", () => {
    expect(contactGlow(0)).toEqual({ level: "none", color: null, intensity: 0 });
    expect(contactGlow(TOUCH_N - 0.01).level).toBe("none");
    expect(contactGlow(TOUCH_N)).toMatchObject({ level: "touch", color: GLOW.touch });
    expect(contactGlow(COLLISION_N)).toMatchObject({ level: "touch", color: GLOW.touch }); // the check's predicate is > 5 N
    expect(contactGlow(5.01)).toMatchObject({ level: "collision", color: GLOW.collision });
    expect(contactGlow(927)).toMatchObject({ level: "collision", color: GLOW.collision });
  });

  it("glows brighter as it pushes harder, and stays bounded", () => {
    const at = (n: number) => contactGlow(n).intensity;
    expect(at(1)).toBeLessThan(at(4));
    expect(at(4)).toBeLessThan(at(6)); // red starts brighter than any amber
    expect(at(6)).toBeLessThan(at(75));
    expect(at(75)).toBeLessThan(at(927));
    expect(at(1e6)).toBeCloseTo(1.6, 6);
    expect(at(COLLISION_N)).toBeCloseTo(0.7, 6);
  });

  it("bad numbers glow nothing", () => {
    expect(contactLevel(Number.NaN)).toBe("none");
    expect(contactLevel(-3)).toBe("none");
  });
});

describe("barFraction", () => {
  it("is a log scale from a touch to 1000 N, so 5 N and 500 N both read", () => {
    expect(barFraction(0)).toBe(0);
    expect(barFraction(TOUCH_N)).toBe(0);
    expect(barFraction(BAR_MAX_N)).toBeCloseTo(1, 9);
    expect(barFraction(5000)).toBe(1);
    expect(COLLISION_MARK).toBeCloseTo(Math.log(10) / Math.log(2000), 9); // ~0.30
    expect(barFraction(75)).toBeGreaterThan(0.6);
    expect(barFraction(927)).toBeGreaterThan(0.95);
  });
});

describe("the label", () => {
  it("names the link plainly", () => {
    expect(bodyLabel("panda_hand")).toBe("hand");
    expect(bodyLabel("panda_link4")).toBe("link 4");
    expect(bodyLabel("panda_leftfinger")).toBe("left finger");
    expect(bodyLabel("openarm_right_finger")).toBe("right finger");
    expect(bodyLabel("left_finger_tip")).toBe("left finger tip");
  });

  it("says the force, the link and what it pushes", () => {
    expect(contactText({ forceN: 7.26, body: "panda_hand", against: "bin" })).toBe("7.3 N · hand on the bin");
    expect(contactText({ forceN: 312.4, body: "panda_leftfinger", against: "table" })).toBe("312 N · left finger on the table");
    expect(contactText({ forceN: 0.1, body: null, against: null })).toBe("no contact");
    expect(contactText(null)).toBe("no contact");
  });
});
