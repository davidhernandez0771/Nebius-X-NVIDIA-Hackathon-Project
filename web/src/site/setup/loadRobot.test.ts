import { describe, expect, it } from "vitest";
import franka from "./fixtures/franka.parts.json";
import { loadRobot } from "./loadRobot";
import { makeZip } from "./testZip";
import type { Parts } from "./types";

const panda = franka as unknown as Parts;

const BOX_URDF = `<robot name="boxy">
  <link name="base"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
  <link name="tip"><visual><geometry><mesh filename="package://boxy/meshes/tip.stl"/></geometry></visual></link>
  <joint name="j1" type="revolute"><parent link="base"/><child link="tip"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/>
    <limit lower="-1" upper="1" effort="1" velocity="1"/></joint>
</robot>`;

describe("loadRobot", () => {
  it("draws a recorded robot as a stick figure from its parts", async () => {
    const out = await loadRobot({ file: null, parts: panda });
    expect(out).toMatchObject({ stick: true, from: "parts" });
    expect(Object.keys(out.robot.joints)).toHaveLength(panda.joints.length);
  });

  it("keeps a bare URDF's primitives and lists the meshes it can't reach", async () => {
    const out = await loadRobot({ file: new File([BOX_URDF], "boxy.urdf"), parts: panda });
    expect(out.stick).toBe(false);
    expect(out.meshes.failed).toHaveLength(1);
  });

  it("loads meshes from a zip, resolving package:// through package.xml", async () => {
    const stl = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    const zip = await makeZip([
      { name: "src/package.xml", data: "<package><name>boxy</name></package>" },
      { name: "src/urdf/boxy.urdf", data: BOX_URDF },
      { name: "src/meshes/tip.stl", data: stl, deflate: true },
    ]);
    const out = await loadRobot({ file: new File([zip], "boxy.zip"), parts: panda });
    expect(out).toMatchObject({ stick: false, from: "zip", meshes: { ok: 1, failed: [] } });
  });

  it("falls back to the stick figure when nothing solid loads", async () => {
    const bare = BOX_URDF.replace('<visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual>', "");
    const out = await loadRobot({ file: new File([bare], "boxy.urdf"), parts: panda });
    expect(out.stick).toBe(true);
  });
});
