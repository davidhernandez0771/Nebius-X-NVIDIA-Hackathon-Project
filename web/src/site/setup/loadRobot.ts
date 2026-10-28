// Builds the robot for the 3D preview with urdf-loader: from the uploaded zip (meshes resolved inside it, like the
// backend does), from a bare .urdf (primitives only), or from the parts JSON (a recorded robot, no meshes).
import { Mesh, MeshStandardMaterial, type Object3D } from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { urdfFromParts } from "./robotModel";
import type { Parts } from "./types";
import { dirname, findUrdf, joinPath, packageRoots } from "./urdfFiles";
import { openZip, type ZipReader } from "./zip";

export type Loaded = {
  robot: URDFRobot;
  /** Mesh files loaded and failed; `stick` when nothing solid could be drawn. */
  meshes: { ok: number; failed: string[] };
  stick: boolean;
  from: "zip" | "urdf" | "parts";
};

const ZIP = "zip://";
const MISSING = "__missing__/";

async function parseMesh(zip: ZipReader, path: string): Promise<Object3D> {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "stl") {
    const bytes = await zip.bytes(path);
    const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    return new Mesh(geometry, new MeshStandardMaterial());
  }
  if (ext === "dae") {
    const dae = new ColladaLoader().parse(await zip.text(path), "");
    if (!dae) throw new Error(`${path}: not a COLLADA file`);
    return dae.scene;
  }
  if (ext === "obj") return new OBJLoader().parse(await zip.text(path));
  throw new Error(`${path}: the preview reads STL, DAE and OBJ`);
}

const hasSolid = (robot: URDFRobot) => {
  let solid = false;
  robot.traverse((o) => {
    if ((o as Mesh).isMesh) solid = true;
  });
  return solid;
};

export async function loadRobot({ file, parts }: { file: File | null; parts: Parts }): Promise<Loaded> {
  if (!file) return { robot: new URDFLoader().parse(urdfFromParts(parts)), meshes: { ok: 0, failed: [] }, stick: true, from: "parts" };

  const loader = new URDFLoader();
  loader.parseVisual = true;
  loader.parseCollision = true;
  const failed: string[] = [];
  const pending: Promise<void>[] = [];
  let ok = 0;

  if (!file.name.toLowerCase().endsWith(".zip")) {
    loader.loadMeshCb = (url, _m, _mat, done) => {
      failed.push(url);
      done(null as unknown as Object3D);
    };
    const robot = loader.parse(await file.text());
    return { robot, meshes: { ok, failed }, stick: !hasSolid(robot), from: "urdf" };
  }

  const zip = openZip(await file.arrayBuffer());
  const found = findUrdf(zip.names);
  if ("error" in found) throw new Error(found.error.message);
  const xml: Record<string, string> = {};
  for (const n of zip.names.filter((x) => x.endsWith("package.xml"))) xml[n] = await zip.text(n);
  const roots = packageRoots(zip.names, xml);
  const names = new Set(zip.names);

  loader.packages = (pkg: string) => ZIP + (roots.get(pkg) ?? MISSING + pkg);
  loader.workingPath = ZIP + (dirname(found.path) ? `${dirname(found.path)}/` : "");
  loader.loadMeshCb = (url, _manager, _material, done) => {
    const path = joinPath("", url.startsWith(ZIP) ? url.slice(ZIP.length) : url);
    if (!names.has(path)) {
      failed.push(url.replace(ZIP, "").replace(MISSING, "package://"));
      return done(null as unknown as Object3D);
    }
    pending.push(
      parseMesh(zip, path).then(
        (obj) => {
          ok += 1;
          done(obj);
        },
        () => {
          failed.push(path);
          done(null as unknown as Object3D);
        },
      ),
    );
  };
  const robot = loader.parse(await zip.text(found.path));
  await Promise.all(pending);
  return { robot, meshes: { ok, failed }, stick: !hasSolid(robot), from: "zip" };
}
