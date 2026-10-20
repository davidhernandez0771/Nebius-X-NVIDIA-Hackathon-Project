// What the first request of `/` carries. The journey is the front door: the app shell (App.tsx and
// what it imports statically) and the world's first chunk (WorldRoot) should hold only what the loader
// needs. The archive, the work pages, the hand cursor (MediaPipe) and the robot twin (urdf-loader)
// load when they are used. A static import of any of them from here would put it back in the first
// load without a test noticing, so this walks the source's static import graph.
import { describe, expect, it } from "vitest";

// Every module's source (raw text; nothing is executed).
const SOURCES = import.meta.glob("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The static imports of one module: `import … from "x"`, `import "x"`, `export … from "x"`, not `import type` or `import()`. */
export function staticSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[^"'();=]*?\s+from\s+)?["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) if (!m[2]) out.push(m[3]);
  return out;
}

function resolve(from: string, spec: string, files: Record<string, string>): string | null {
  const dir = from.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "..") dir.pop();
    else if (part !== ".") dir.push(part);
  }
  const base = dir.join("/");
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (files[base + ext] !== undefined) return base + ext;
  return null;
}

/** Everything `entry` pulls in statically: the modules under src, and the packages. */
export function reach(entry: string, files: Record<string, string> = SOURCES): { modules: Set<string>; packages: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (modules.has(f)) continue;
    modules.add(f);
    for (const spec of staticSpecifiers(files[f] ?? "")) {
      if (!spec.startsWith(".")) {
        if (!/\.css$/.test(spec)) packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
        continue;
      }
      const to = resolve(f, spec, files);
      if (to) stack.push(to);
    }
  }
  return { modules, packages };
}

describe("the static import graph", () => {
  it("reads static imports, not type-only or dynamic ones", () => {
    const code = [
      'import { a } from "./a";',
      'import type { B } from "./b";',
      'import "./c.css";',
      'export { d } from "./d";',
      'const E = lazy(() => import("./e"));',
      "import {\n  f,\n  g,\n} from \"three\";",
    ].join("\n");
    expect(staticSpecifiers(code)).toEqual(["./a", "./c.css", "./d", "three"]);
  });

  it("follows relative imports through index files", () => {
    const files = { "./a.ts": 'import { b } from "./lib";', "./lib/index.ts": 'import x from "pkg/sub";\nimport y from "@s/p/q";' };
    const { modules, packages } = reach("./a.ts", files);
    expect([...modules]).toEqual(["./a.ts", "./lib/index.ts"]);
    expect([...packages].sort()).toEqual(["@s/p", "pkg"]);
  });
});

describe("the first load of /", () => {
  const app = reach("./App.tsx");
  const world = reach("./world/core/WorldRoot.tsx");

  it("keeps the archive, the work pages and the hand cursor out of the app shell", () => {
    const heavy = [...app.modules].filter((m) => /^\.\/(legacy|work|hand|twin|pm)\//.test(m));
    expect(heavy).toEqual([]);
  });

  it("keeps three.js, MediaPipe and urdf-loader out of the app shell", () => {
    for (const p of ["three", "@react-three/fiber", "@react-three/drei", "@mediapipe/tasks-vision", "urdf-loader"]) expect(app.packages).not.toContain(p);
  });

  it("fetches MediaPipe (≈130 KB) only when the hand cursor is switched on, not with the pages that offer it", () => {
    for (const page of ["./work/WorkShell.tsx", "./legacy/LegacyHand.tsx"]) expect(reach(page).packages).not.toContain("@mediapipe/tasks-vision");
  });

  // Only the intro's Scene draws under the loader; the workshop's and the machine's mount after it
  // (WorldCanvas), so their code, and drei's GLTF loader with them, can come after the first frame too.
  it("keeps the workshop's and the machine's 3D (and the GLTF loader) out of the world's first chunk", () => {
    const later = ["./world/stations/workshop/Scene.tsx", "./world/stations/machine/Scene.tsx", "./world/scene/Helix.tsx", "./world/scene/HoloTwin.tsx", "./world/scene/Baked.tsx"];
    expect(later.filter((m) => world.modules.has(m))).toEqual([]);
    expect(world.modules.has("./world/stations/intro/Scene.tsx")).toBe(true);
  });

  it("loads the robot twin and MediaPipe only when they are used, not with the world", () => {
    expect(world.packages).toContain("three");
    expect(world.packages).not.toContain("urdf-loader");
    expect(world.packages).not.toContain("@mediapipe/tasks-vision");
  });
});
