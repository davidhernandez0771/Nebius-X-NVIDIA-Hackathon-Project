import { describe, expect, it } from "vitest";
import { findUrdf, joinPath, packageRoots, resolveMeshRef } from "./urdfFiles";

describe("findUrdf", () => {
  it("finds the one .urdf", () => {
    expect(findUrdf(["pkg/package.xml", "pkg/robots/panda.urdf", "pkg/meshes/a.stl"])).toEqual({ path: "pkg/robots/panda.urdf" });
  });

  it("names the problem like the backend does", () => {
    expect(findUrdf(["a.stl"])).toMatchObject({ error: { code: "no_urdf" } });
    expect(findUrdf(["a.urdf", "b/c.urdf"])).toMatchObject({ error: { code: "multiple_urdfs" } });
    expect(findUrdf(["robot.urdf.xacro"])).toMatchObject({ error: { code: "xacro" } });
  });
});

describe("joinPath", () => {
  it("resolves . and .. segments", () => {
    expect(joinPath("pkg/robots", "../meshes/./a.stl")).toBe("pkg/meshes/a.stl");
    expect(joinPath("", "./meshes/a.obj")).toBe("meshes/a.obj");
  });
});

describe("packageRoots", () => {
  it("maps a folder name and a package.xml <name> to the folder", () => {
    const roots = packageRoots(["franka_description/package.xml", "franka_description/meshes/a.dae", "x/y/package.xml"], {
      "x/y/package.xml": "<package><name>other_pkg</name></package>",
    });
    expect(roots.get("franka_description")).toBe("franka_description");
    expect(roots.get("meshes")).toBe("franka_description/meshes");
    expect(roots.get("other_pkg")).toBe("x/y");
  });
});

describe("resolveMeshRef", () => {
  const names = ["franka_description/robots/panda.urdf", "franka_description/meshes/visual/link0.dae", "meshes/mesh_1.obj"];
  const roots = packageRoots(names, {});

  it("resolves package:// through the package roots", () => {
    expect(resolveMeshRef("package://franka_description/meshes/visual/link0.dae", "franka_description/robots", roots, names)).toBe(
      "franka_description/meshes/visual/link0.dae",
    );
  });

  it("resolves relative paths from the URDF's folder", () => {
    expect(resolveMeshRef("./meshes/mesh_1.obj", "", roots, names)).toBe("meshes/mesh_1.obj");
    expect(resolveMeshRef("../meshes/visual/link0.dae", "franka_description/robots", roots, names)).toBe(
      "franka_description/meshes/visual/link0.dae",
    );
  });

  it("returns null for a mesh that is not in the upload", () => {
    expect(resolveMeshRef("package://nope/a.stl", "", roots, names)).toBeNull();
    expect(resolveMeshRef("meshes/missing.stl", "", roots, names)).toBeNull();
  });
});
