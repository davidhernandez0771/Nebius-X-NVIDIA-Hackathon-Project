import { describe, expect, it } from "vitest";
import { ITEMS, TAGS } from "../scene/items";
import { TOOLS, callLine, route, validCall } from "./registry";

describe("Ask SANT's tools", () => {
  it("are the brief's four, each with its allowed values", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["go_to_section", "show_cartridges_with_tag", "open_cartridge", "start_tutorial"]);
    expect(TOOLS[1].values).toEqual(TAGS.map((t) => t.id));
    expect(TOOLS[2].values).toEqual(ITEMS.map((i) => i.id));
    expect(TOOLS[3].values).toBeNull();
  });

  it("only lets through a known tool with one of its values", () => {
    expect(validCall("show_cartridges_with_tag", "results")).toEqual({ tool: "show_cartridges_with_tag", arg: "results" });
    expect(validCall("start_tutorial", "whatever")).toEqual({ tool: "start_tutorial", arg: null });
    expect(validCall("show_cartridges_with_tag", "games")).toBeNull();
    expect(validCall("go_to_section", null)).toBeNull();
    expect(validCall("eval", "x")).toBeNull();
    expect(callLine({ tool: "show_cartridges_with_tag", arg: "results" })).toBe('› show_cartridges_with_tag("results")');
    expect(callLine({ tool: "start_tutorial", arg: null })).toBe("› start_tutorial()");
  });
});

describe("the keyword fallback", () => {
  it("picks a tool for the obvious questions", () => {
    expect(route("show me your results")).toEqual({ tool: "show_cartridges_with_tag", arg: "results" });
    expect(route("open the grasp fix")).toEqual({ tool: "open_cartridge", arg: "grasp-fix" });
    expect(route("how do I record a demo with my webcam?")).toEqual({ tool: "show_cartridges_with_tag", arg: "record" });
    expect(route("give me a tour")).toEqual({ tool: "start_tutorial", arg: null });
    expect(route("back to the beginning")).toEqual({ tool: "go_to_section", arg: "top" });
    expect(route("I want to make a new cartridge")).toEqual({ tool: "go_to_section", arg: "bench" });
    expect(route("Which robots does SANT support?")).toEqual({ tool: "go_to_section", arg: "robots" });
    expect(route("show me the robot wall")).toEqual({ tool: "go_to_section", arg: "robots" });
    expect(route("bring your robot")).toEqual({ tool: "show_cartridges_with_tag", arg: "robot" });
    expect(route("hmm")).toEqual({ tool: "go_to_section", arg: "workshop" });
  });

  it("always returns a call the registry accepts", () => {
    for (const q of ["", "physics", "train a policy", "the machine", "17 / 40", "why sant", "urdf"]) {
      const c = route(q);
      expect(validCall(c.tool, c.arg)).toEqual(c);
    }
  });
});
