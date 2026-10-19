// Finds the URDF in an upload and resolves the mesh paths it names, with the backend's rules (byor-api.md §1):
// `package://<pkg>/<path>` goes to the folder named <pkg>, or the folder whose package.xml says <name><pkg></name>;
// other paths are relative to the URDF's folder.
import type { Issue } from "./types";

const issue = (code: string, message: string): Issue => ({ code, severity: "error", message, where: "file" });

export function findUrdf(names: string[]): { path: string } | { error: Issue } {
  const urdfs = names.filter((n) => n.toLowerCase().endsWith(".urdf"));
  if (urdfs.length === 1) return { path: urdfs[0] };
  if (urdfs.length > 1) return { error: issue("multiple_urdfs", `the zip has ${urdfs.length} URDFs (${urdfs.join(", ")}); upload one`) };
  if (names.some((n) => n.toLowerCase().endsWith(".xacro")))
    return { error: issue("xacro", "the zip has only .xacro files: run `xacro robot.urdf.xacro > robot.urdf` and upload the result") };
  return { error: issue("no_urdf", "the zip has no .urdf file") };
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${rel}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Package name → folder: every folder by its own name, then package.xml names (which win). */
export function packageRoots(names: string[], packageXml: Record<string, string>): Map<string, string> {
  const roots = new Map<string, string>();
  for (const n of names) {
    const parts = n.split("/").slice(0, -1);
    parts.forEach((p, i) => {
      const dir = parts.slice(0, i + 1).join("/");
      if (!roots.has(p)) roots.set(p, dir);
    });
  }
  for (const [path, xml] of Object.entries(packageXml)) {
    const m = /<name>\s*([^<\s]+)\s*<\/name>/.exec(xml);
    if (m) roots.set(m[1], dirname(path));
  }
  return roots;
}

export function resolveMeshRef(ref: string, urdfDir: string, roots: Map<string, string>, names: string[]): string | null {
  let path: string;
  const pkg = /^package:\/\/([^/]+)\/(.*)$/.exec(ref);
  if (pkg) {
    const root = roots.get(pkg[1]);
    if (root === undefined) return null;
    path = joinPath(root, pkg[2]);
  } else {
    path = joinPath(urdfDir, ref.replace(/^file:\/\//, ""));
  }
  return names.includes(path) ? path : null;
}
