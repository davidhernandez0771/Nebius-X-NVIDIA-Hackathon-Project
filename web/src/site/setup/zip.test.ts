import { describe, expect, it } from "vitest";
import { makeZip } from "./testZip";
import { openZip } from "./zip";

describe("openZip", () => {
  it("lists files, skipping folders", async () => {
    const zip = openZip(await makeZip([{ name: "pkg/", data: "" }, { name: "pkg/robot.urdf", data: "<robot/>" }]));
    expect(zip.names).toEqual(["pkg/robot.urdf"]);
  });

  it("reads stored and deflated entries", async () => {
    const text = "<robot name='panda'>" + "x".repeat(500) + "</robot>";
    const zip = openZip(await makeZip([{ name: "a.txt", data: "stored" }, { name: "b/robot.urdf", data: text, deflate: true }]));
    expect(await zip.text("a.txt")).toBe("stored");
    expect(await zip.text("b/robot.urdf")).toBe(text);
  });

  it("normalizes backslashes in names", async () => {
    const zip = openZip(await makeZip([{ name: "meshes\\link0.stl", data: "s" }]));
    expect(zip.names).toEqual(["meshes/link0.stl"]);
  });

  it("rejects bytes that are not a zip", async () => {
    expect(() => openZip(new TextEncoder().encode("not a zip at all").buffer)).toThrow(/not a zip/);
  });

  it("throws for a missing entry", async () => {
    const zip = openZip(await makeZip([{ name: "a.txt", data: "x" }]));
    await expect(zip.bytes("b.txt")).rejects.toThrow(/b.txt/);
  });
});
