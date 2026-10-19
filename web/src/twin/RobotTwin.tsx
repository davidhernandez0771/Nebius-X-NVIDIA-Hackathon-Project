// The robot twin: the sim's robot, cube and bin in 3D, posed from joint states (live from the sink, or a saved
// episode). The Record page's hologram look: a dark matte robot with teal edges, the hand and fingers in the
// needle colour while the gripper is closed, the cube and the amber bin on the cutting-mat grid.
// Light on the GPU: it renders only when a prop changes or the view is turned (frameloop "demand"), at a pixel
// ratio of at most 1.5. Lazy: three.js and urdf-loader load with this file, not with the page (see ./index.ts).
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import type { URDFLink, URDFRobot } from "urdf-loader";
import { loadTwinRobot, type LoadedTwin } from "./loadTwinRobot";
import { applyJoints, binParts, boneSegments, CUBE_SIZE, FRANKA, gripperLinkSet, matLines, quat, TABLE } from "./model";
import type { TwinPose, TwinState } from "./types";
import "./twin.css";

// The hologram's colours (web/src/site/record/record-hologram.css, the .rg tokens).
const C = { void: "#040607", live: "#19F5C2", needle: "#FF5A1F", hold: "#FFB000", cube: "#D9D8D2", ink3: "#53625F" };

const matte = new MeshStandardMaterial({ color: "#1B2427", roughness: 0.82, metalness: 0.12 });
const matteHot = new MeshStandardMaterial({ color: "#2A1A14", roughness: 0.7, metalness: 0.1, emissive: C.needle, emissiveIntensity: 0.18 });
const edge = new LineBasicMaterial({ color: C.live, transparent: true, opacity: 0.5 });
const edgeHot = new LineBasicMaterial({ color: C.needle, transparent: true, opacity: 0.95 });
const SHARED: Material[] = [matte, matteHot, edge, edgeHot];

const ownerLink = (o: { parent: unknown }): URDFLink | null => {
  for (let p = o as { parent: unknown; isURDFLink?: boolean } | null; p; p = p.parent as typeof p)
    if (p.isURDFLink) return p as unknown as URDFLink;
  return null;
};

/** Matte meshes with thin edges; the stick figure when the meshes didn't load. Done once per loaded robot. */
function dress({ robot, stick }: LoadedTwin): void {
  if (stick) {
    robot.traverse((o) => {
      if ((o as { isURDFCollider?: boolean }).isURDFCollider) o.visible = false;
    });
    const r = 0.022;
    for (const b of boneSegments(robot)) {
      const len = b.to.length();
      const bone = new Mesh(new CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 12), matte);
      bone.position.copy(b.to).multiplyScalar(0.5);
      bone.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.to.clone().normalize()));
      bone.userData.twin = true;
      robot.links[b.link].add(bone);
      const dot = new Mesh(new SphereGeometry(r * 1.35, 16, 12), matte);
      dot.position.copy(b.to);
      dot.userData.twin = true;
      robot.links[b.link].add(dot);
    }
  }
  const meshes: Mesh[] = [];
  robot.traverse((o) => {
    if ((o as Mesh).isMesh && o.visible !== false) meshes.push(o as Mesh);
  });
  for (const m of meshes) {
    m.material = matte;
    if (stick) continue; // capsules read as shapes; edges on them are noise
    const lines = new LineSegments(new EdgesGeometry(m.geometry as BufferGeometry, 28), edge);
    lines.userData.edge = true;
    lines.raycast = () => {};
    m.add(lines);
  }
}

function dispose(robot: URDFRobot) {
  robot.traverse((o) => {
    (o as Mesh).geometry?.dispose();
    const mat = (o as Mesh).material as Material | Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (!SHARED.includes(x)) x.dispose();
  });
}

/** Poses the robot and paints the gripper; asks for one frame only when something changed. */
function Robot({ loaded, joints, gripper }: { loaded: LoadedTwin; joints: Record<string, number> | null; gripper: 0 | 1 | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const { robot } = loaded;
  const hot = useMemo(() => gripperLinkSet(robot), [robot]);

  useEffect(() => {
    if (applyJoints(robot, joints ?? FRANKA.rest)) invalidate();
  }, [robot, joints, invalidate]);

  useEffect(() => {
    const closed = gripper === 1;
    robot.traverse((o) => {
      const link = ownerLink(o);
      if (!link || !hot.has(link)) return;
      if ((o as Mesh).isMesh) (o as Mesh).material = closed ? matteHot : matte;
      else if (o.userData.edge) (o as LineSegments).material = closed ? edgeHot : edge;
    });
    invalidate();
  }, [robot, hot, gripper, invalidate]);

  return <primitive object={robot} />;
}

function Mat() {
  const [minor, major] = useMemo(() => {
    const geo = (major: boolean) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(matLines().filter((l) => l.major === major).flatMap((l) => [...l.a, ...l.b]), 3));
      return g;
    };
    return [geo(false), geo(true)];
  }, []);
  return (
    <group position={[0, 0, 0.0005]}>
      <lineSegments geometry={minor}>
        <lineBasicMaterial color={C.live} transparent opacity={0.09} />
      </lineSegments>
      <lineSegments geometry={major}>
        <lineBasicMaterial color={C.live} transparent opacity={0.22} />
      </lineSegments>
    </group>
  );
}

function Table() {
  const box = useMemo(() => new BoxGeometry(...TABLE.size), []);
  const edges = useMemo(() => new EdgesGeometry(box), [box]);
  return (
    <group position={TABLE.center}>
      <mesh geometry={box}>
        <meshStandardMaterial color="#0A1012" roughness={0.95} metalness={0} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={C.live} transparent opacity={0.28} />
      </lineSegments>
    </group>
  );
}

function Bin({ pose }: { pose: TwinPose }) {
  const parts = useMemo(
    () =>
      binParts().map((p) => {
        const g = new BoxGeometry(...p.size);
        return { ...p, g, e: new EdgesGeometry(g) };
      }),
    [],
  );
  return (
    <group position={pose.pos} quaternion={quat(pose.quat)}>
      {parts.map((p) => (
        <group key={p.name} position={p.center}>
          <mesh geometry={p.g}>
            <meshStandardMaterial color="#17130A" roughness={0.9} transparent opacity={0.85} />
          </mesh>
          <lineSegments geometry={p.e}>
            <lineBasicMaterial color={C.hold} transparent opacity={0.75} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

function Cube({ pose }: { pose: TwinPose }) {
  const box = useMemo(() => new BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), []);
  const edges = useMemo(() => new EdgesGeometry(box), [box]);
  return (
    <group position={pose.pos} quaternion={quat(pose.quat)}>
      <mesh geometry={box}>
        <meshStandardMaterial color={C.cube} roughness={0.75} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#FFFFFF" transparent opacity={0.5} />
      </lineSegments>
    </group>
  );
}

/** The operator's view: behind the robot, high and a little to its right, looking down the table (the robot's left
 *  on the left, as in the mirrored camera). Straight behind, the arm hid the cube and bin. A narrow pane steps back
 *  so the table still fits. Drag to turn, scroll to zoom. */
function View({ interactive }: { interactive: boolean }) {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  // three.js is y up; the sim is z up: (x, y, z)_sim -> (x, z, -y)_three
  const target = useMemo(() => new Vector3(0.42, 0.08, 0), []);
  const position = useMemo(() => {
    const back = Math.max(1, 1.25 / aspect);
    return target.clone().add(new Vector3(-0.8, 1.25, 0.5).multiplyScalar(back));
  }, [aspect, target]);
  return (
    <>
      <PerspectiveCamera makeDefault position={position} fov={38} near={0.02} far={20} />
      <OrbitControls makeDefault target={target} enabled={interactive} enableDamping={false} enablePan={false} minDistance={0.5} maxDistance={4} maxPolarAngle={Math.PI * 0.49} />
    </>
  );
}

function Scene({ loaded, state, base, interactive }: { loaded: LoadedTwin; state: TwinState; base: TwinPose | null; interactive: boolean }) {
  return (
    <>
      <color attach="background" args={[C.void]} />
      <hemisphereLight args={["#B8D6D0", C.void, 0.65]} />
      <directionalLight position={[-1.5, 3, 1.5]} intensity={1.25} />
      <directionalLight position={[2.5, 1.2, -2]} intensity={0.5} color="#8FEFDC" />
      <View interactive={interactive} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Table />
        <Mat />
        {state.bin && <Bin pose={state.bin} />}
        {state.cube && <Cube pose={state.cube} />}
        <group position={base?.pos ?? [0, 0, 0]} quaternion={base ? quat(base.quat) : undefined}>
          <Robot loaded={loaded} joints={state.joints} gripper={state.gripper} />
        </group>
      </group>
    </>
  );
}

type Load = { status: "loading" } | { status: "ready"; loaded: LoadedTwin } | { status: "error"; message: string };

export type RobotTwinProps = TwinState & {
  /** The robot's root (from the scene); the Franka's is the origin. */
  base?: TwinPose | null;
  /** Drag to turn and scroll to zoom (default on). */
  interactive?: boolean;
  /** A line under the view, e.g. what it shows ("Live from the sim", "Replay: verified copy …"). */
  caption?: ReactNode;
  className?: string;
};

export default function RobotTwin({ joints, gripper, cube, bin, base = null, interactive = true, caption, className }: RobotTwinProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let live = true;
    loadTwinRobot().then(
      (loaded) => {
        if (!live) return dispose(loaded.robot);
        dress(loaded);
        setLoad({ status: "ready", loaded });
      },
      (e: Error) => live && setLoad({ status: "error", message: e.message }),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => void (load.status === "ready" && dispose(load.loaded.robot)), [load]);

  const state = useMemo(() => ({ joints, gripper, cube, bin }), [joints, gripper, cube, bin]);
  const note =
    load.status === "ready" && load.loaded.stick
      ? `Stick figure: ${load.loaded.meshes.failed.length} of the robot's meshes didn't load.`
      : null;

  return (
    <div className={["twin3d", className].filter(Boolean).join(" ")}>
      {load.status === "ready" ? (
        <Canvas className="twin3d__canvas" frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "low-power" }}>
          <Scene loaded={load.loaded} state={state} base={base} interactive={interactive} />
        </Canvas>
      ) : (
        <p className="twin3d__wait" role={load.status === "error" ? "alert" : undefined}>
          {load.status === "loading" ? "Loading the robot…" : `The robot didn't load: ${load.message}`}
        </p>
      )}
      {(caption || note) && (
        <p className="twin3d__caption">
          {caption}
          {note && <span className="twin3d__note">{note}</span>}
        </p>
      )}
    </div>
  );
}
