// Loads the twin's robot with urdf-loader, as the Robot setup preview does (web/src/site/setup/loadRobot.ts on
// pm/web-setup), but from the files the page serves (web/public/robots/) instead of an uploaded zip. It draws the
// collision meshes (STL, 140 KB for the Franka) rather than the 10 MB of visual ones. If any mesh doesn't load, it
// says so and the twin draws the stick figure instead of half a robot.
import { Mesh, MeshStandardMaterial, type Object3D } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { FRANKA } from "./model";

export type LoadedTwin = {
  robot: URDFRobot;
  meshes: { ok: number; failed: string[] };
  /** Draw the stick figure: no mesh loaded, or one didn't. */
  stick: boolean;
};

type RobotFiles = { urdf: string; packages: Record<string, string> };

async function bytes(fetchImpl: typeof fetch, url: string): Promise<ArrayBuffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function loadTwinRobot(files: RobotFiles = FRANKA, fetchImpl: typeof fetch = fetch): Promise<LoadedTwin> {
  const xml = new TextDecoder().decode(await bytes(fetchImpl, files.urdf));
  const loader = new URDFLoader();
  loader.parseVisual = false;
  loader.parseCollision = true;
  loader.packages = files.packages;
  const failed: string[] = [];
  const pending: Promise<void>[] = [];
  let ok = 0;
  loader.loadMeshCb = (url, _manager, _material, done) => {
    if (!url.toLowerCase().endsWith(".stl")) {
      failed.push(url);
      return done(null as unknown as Object3D);
    }
    pending.push(
      bytes(fetchImpl, url).then(
        (buf) => {
          ok += 1;
          done(new Mesh(new STLLoader().parse(buf), new MeshStandardMaterial()));
        },
        () => {
          failed.push(url);
          done(null as unknown as Object3D);
        },
      ),
    );
  };
  const robot = loader.parse(xml);
  await Promise.all(pending);
  robot.traverse((o) => {
    if ((o as { isURDFCollider?: boolean }).isURDFCollider) o.visible = true;
  });
  return { robot, meshes: { ok, failed }, stick: ok === 0 || failed.length > 0 };
}
