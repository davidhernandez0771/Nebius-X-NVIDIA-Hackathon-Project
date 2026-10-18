import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  Box3,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import type { URDFLink, URDFRobot } from "urdf-loader";
import { loadRobot, type Loaded } from "./loadRobot";
import { focusLinks, stickFigure } from "./robotModel";
import type { Robot } from "./SetupPage";

// Volt, as three.js colours (web/src/sant/tokens.css [data-mode="volt"]).
const VOLT = { bg: "#07090C", surface2: "#151A21", line: "#2A323C", control: "#5E6A77", muted: "#8B95A1", accent: "#19F5C2" };

// The task's cube area (byor-api.md §6 task.workspace: cube_x 0.40-0.60, cube_y -0.20-0.20), drawn on the table.
const CUBE_AREA = { x: [0.4, 0.6], y: [-0.2, 0.2] };

const matte = new MeshStandardMaterial({ color: "#1A2129", roughness: 0.82, metalness: 0.08 });
const lit = new MeshStandardMaterial({ color: "#0F3B32", roughness: 0.55, metalness: 0.05, emissive: VOLT.accent, emissiveIntensity: 0.55 });
const edge = new LineBasicMaterial({ color: "#4A5664", transparent: true, opacity: 0.55 });
const edgeLit = new LineBasicMaterial({ color: VOLT.accent });
const joint = new MeshStandardMaterial({ color: VOLT.control, roughness: 0.6 });

const ownerLink = (o: Object3D): string | null => {
  for (let p: Object3D | null = o; p; p = p.parent) if ((p as URDFLink).isURDFLink) return p.name || (p as URDFLink).urdfName;
  return null;
};

/** Dark matte meshes with thin edges; a link with visuals hides its colliders, one without shows them. */
function dress(robot: URDFRobot) {
  for (const link of Object.values(robot.links)) {
    const kids = link.children;
    const visual = kids.filter((k) => (k as { isURDFVisual?: boolean }).isURDFVisual);
    let hasVisualMesh = false;
    for (const v of visual) v.traverse((o) => ((o as Mesh).isMesh ? (hasVisualMesh = true) : null));
    for (const k of kids) if ((k as { isURDFCollider?: boolean }).isURDFCollider) k.visible = !hasVisualMesh;
  }
  const meshes: Mesh[] = [];
  robot.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  for (const m of meshes) {
    m.material = matte;
    m.userData.link = ownerLink(m);
    const lines = new LineSegments(new EdgesGeometry(m.geometry as BufferGeometry, 30), edge);
    lines.userData.edge = true;
    lines.raycast = () => {};
    m.add(lines);
  }
}

function dispose(robot: URDFRobot) {
  robot.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    g?.dispose();
    const mat = (o as Mesh).material as Material | Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (![matte, lit, edge, edgeLit, joint].includes(x as never)) x.dispose();
  });
}

function Frame({ target, size }: { target: Vector3; size: number }) {
  const pos = useMemo(() => target.clone().add(new Vector3(1.25, 0.75, 1.35).multiplyScalar(Math.max(size, 0.4) * 1.35)), [target, size]);
  return (
    <>
      <PerspectiveCamera makeDefault position={pos} fov={32} near={0.01} far={50} />
      <OrbitControls makeDefault target={target} enableDamping={false} minDistance={0.2} maxDistance={8} />
    </>
  );
}

function Workspace() {
  const geometry = useMemo(() => {
    const [x0, x1] = CUBE_AREA.x;
    const [y0, y1] = CUBE_AREA.y;
    const g = new BufferGeometry();
    // z-up robot frame, a hair above the table so it doesn't flicker against the grid
    g.setAttribute("position", new Float32BufferAttribute([x0, y0, 0.001, x1, y0, 0.001, x1, y0, 0.001, x1, y1, 0.001, x1, y1, 0.001, x0, y1, 0.001, x0, y1, 0.001, x0, y0, 0.001], 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={VOLT.accent} transparent opacity={0.35} />
    </lineSegments>
  );
}

function Bones({ robot, focus }: { robot: URDFRobot; focus: string[] }) {
  const fig = useMemo(() => stickFigure(robot), [robot]);
  const r = Math.max(0.008, fig.size * 0.012);
  const up = new Vector3(0, 1, 0);
  return (
    <group>
      {fig.bones.map((b, i) => {
        const dir = b.b.clone().sub(b.a);
        const len = dir.length();
        const q = new Quaternion().setFromUnitVectors(up, dir.clone().normalize());
        const mid = b.a.clone().add(b.b).multiplyScalar(0.5);
        const on = focus.includes(b.link);
        return (
          <mesh key={i} position={mid} quaternion={q} material={on ? lit : matte}>
            <capsuleGeometry args={[r, Math.max(0.001, len - 2 * r), 4, 12]} />
          </mesh>
        );
      })}
      {fig.dots.map((d) => (
        <mesh key={d.joint} position={d.p} material={joint}>
          <sphereGeometry args={[r * 1.45, 16, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function Solid({ robot, focus }: { robot: URDFRobot; focus: string[] }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    robot.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.material = focus.includes(m.userData.link) ? lit : matte;
      else if ((o as LineSegments).isLineSegments && o.userData.edge) (o as LineSegments).material = focus.includes(ownerLink(o) ?? "") ? edgeLit : edge;
    });
    invalidate();
  }, [robot, focus, invalidate]);
  return <primitive object={robot} />;
}

function Scene({ loaded, focus, mount }: { loaded: Loaded; focus: string[]; mount: [number, number, number] }) {
  const { robot, stick } = loaded;
  // urdf-loader builds the URDF's z-up frame; three.js is y-up.
  const frame = useMemo(() => {
    robot.updateMatrixWorld(true);
    const box = stick ? null : new Box3().setFromObject(robot);
    const fig = stick ? stickFigure(robot) : null;
    const c = box ? box.getCenter(new Vector3()) : fig!.center;
    const size = box ? Math.max(...box.getSize(new Vector3()).toArray()) : fig!.size;
    const zUp = new Vector3(c.x + mount[0], c.y + mount[1], c.z + mount[2]);
    return { target: new Vector3(zUp.x, zUp.z, -zUp.y), size };
  }, [robot, stick, mount]);

  return (
    <>
      <color attach="background" args={[VOLT.bg]} />
      <hemisphereLight args={["#AFC2D6", VOLT.bg, 0.55]} />
      <directionalLight position={[2.5, 4, 2]} intensity={1.15} />
      <directionalLight position={[-3, 1.5, -2.5]} intensity={0.55} color="#8FEFDC" />
      <gridHelper args={[3, 30, VOLT.line, "#141A21"]} position={[0, 0, 0]} />
      <Frame target={frame.target} size={frame.size} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Workspace />
        <group position={mount}>{stick ? <Bones robot={robot} focus={focus} /> : <Solid robot={robot} focus={focus} />}</group>
      </group>
    </>
  );
}

type State = { status: "loading" } | { status: "ready"; loaded: Loaded } | { status: "error"; message: string };

export default function RobotPreview({
  robot,
  focus,
  mount = [0, 0, 0],
}: {
  robot: Robot;
  focus: string | null;
  mount?: [number, number, number];
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadRobot({ file: robot.file, parts: robot.parts }).then(
      (loaded) => {
        if (!live) return dispose(loaded.robot);
        if (!loaded.stick) dress(loaded.robot);
        setState({ status: "ready", loaded });
      },
      (e: Error) => live && setState({ status: "error", message: e.message }),
    );
    return () => {
      live = false;
    };
  }, [robot.file, robot.parts]);

  useEffect(() => () => void (state.status === "ready" && dispose(state.loaded.robot)), [state]);

  const lights = useMemo(() => focusLinks(robot.parts, focus), [robot.parts, focus]);

  if (state.status === "loading") return <div className="byor-view__wait">Loading the 3D view…</div>;
  if (state.status === "error")
    return (
      <div className="byor-view__wait" role="alert">
        The 3D view couldn't read this robot: {state.message}
      </div>
    );

  const { loaded } = state;
  return (
    <>
      <Canvas className="byor-view__canvas" frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "low-power" }}>
        <Scene loaded={loaded} focus={lights} mount={mount} />
      </Canvas>
      <p className="byor-view__caption">
        <span>{caption(loaded)}</span>
        <span className="byor-view__how">Drag to turn, scroll to zoom. The teal outline on the floor is where the cubes appear.</span>
      </p>
    </>
  );
}

function caption({ meshes, stick, from }: Loaded): string {
  if (from === "parts") return "Stick figure: recorded robots come without meshes. Drop the robot's zip to see it solid.";
  if (stick && meshes.failed.length) return `Stick figure: ${meshes.failed.length} mesh files didn't load (first: ${meshes.failed[0]}).`;
  if (stick) return "Stick figure: this URDF has no geometry.";
  if (meshes.failed.length) return `${meshes.ok} meshes loaded, ${meshes.failed.length} didn't (first: ${meshes.failed[0]}).`;
  return from === "zip" ? `${meshes.ok} meshes from your zip.` : "Shapes from the URDF.";
}
