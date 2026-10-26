import { describe, expect, it } from "vitest";
import { hashOfBranch, placeOfHash, syncOp } from "./placeHash";

describe("the open place in the URL", () => {
  it("names the three places; the zoom counts as the machine, anything else is no place", () => {
    expect(placeOfHash("#machine")).toBe("machine");
    expect(placeOfHash("#workbench")).toBe("workbench");
    expect(placeOfHash("robots")).toBe("robots");
    expect(placeOfHash("#zoom")).toBeNull();
    expect(placeOfHash("#world-workshop")).toBeNull();
    expect(placeOfHash("")).toBeNull();
    expect(hashOfBranch("zoom")).toBe("#machine");
    expect(hashOfBranch("robots")).toBe("#robots");
    expect(hashOfBranch(null)).toBe("");
    expect(hashOfBranch("intro")).toBe("");
  });

  it("opening a place adds an entry; from another place it replaces it", () => {
    expect(syncOp("machine", "", false)).toEqual({ op: "push", hash: "#machine" });
    expect(syncOp("machine", "#world-workshop", false)).toEqual({ op: "push", hash: "#machine" });
    expect(syncOp("robots", "#machine", true)).toEqual({ op: "replace", hash: "#robots" });
    // Into the projection from the machine: the same entry.
    expect(syncOp("zoom", "#machine", true)).toEqual({ op: "none" });
  });

  it("closing pops the entry the world added, or only drops the hash of one it didn't", () => {
    expect(syncOp(null, "#machine", true)).toEqual({ op: "back" });
    expect(syncOp(null, "#machine", false)).toEqual({ op: "replace", hash: "" });
    expect(syncOp(null, "", false)).toEqual({ op: "none" });
  });
});
