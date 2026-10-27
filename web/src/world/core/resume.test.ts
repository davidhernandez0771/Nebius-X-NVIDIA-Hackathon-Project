import { beforeEach, describe, expect, it } from "vitest";
import { resumeSpot, saveSpot } from "./resume";

describe("the journey's spot for a reload", () => {
  beforeEach(() => sessionStorage.clear());

  it("is kept as a share of the rail, so another window height lands at the same point", () => {
    saveSpot(sessionStorage, 3000, 12000);
    expect(resumeSpot(sessionStorage, true, 12000)).toBe(3000);
    expect(resumeSpot(sessionStorage, true, 6000)).toBe(1500);
  });

  it("only a reload resumes; the top (or nothing kept, or junk) is no spot", () => {
    saveSpot(sessionStorage, 3000, 12000);
    expect(resumeSpot(sessionStorage, false, 12000)).toBeNull();
    saveSpot(sessionStorage, 0, 12000);
    expect(resumeSpot(sessionStorage, true, 12000)).toBeNull();
    sessionStorage.setItem("world.spot", "{oops");
    expect(resumeSpot(sessionStorage, true, 12000)).toBeNull();
    expect(resumeSpot(undefined, true, 12000)).toBeNull();
  });
});
