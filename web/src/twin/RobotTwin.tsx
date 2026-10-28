// The robot twin: the sim's robot, cube and bin in 3D, posed from joint states (live from the sink, or a saved
// episode). The Record page's hologram look: a dark matte robot with teal edges, the hand and fingers in the
// needle colour while the gripper is closed, the cube and the amber bin on the cutting-mat grid.
// Light on the GPU: it renders only when a prop changes or the view is turned (frameloop "demand"), at a pixel
// ratio of at most 1.5. With `aids` (the Record page): front, side and top views from the one renderer, and the
// top-down alignment grid (./AidViews.tsx). Lazy: three.js and urdf-loader load with this file, not with the page
// (see ./index.ts).
// look="studio" (the test track, ./looks.ts): the Franka's own white and dark paint under a key light and a rim, the
// sim's red cube and blue bin; framePoints: a wide camera that keeps them all in view; trails: paths drawn faintly
// in full and brightly up to now (a dashed one is an estimate).
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import type { URDFLink, URDFRobot } from "urdf-loader";
import { AlignGrid, ThreeViews, useBox, ViewCells } from "./AidViews";
import { alignState, toolInEnv, viewLayout } from "./aids";
import { contactGlow, GLOW, type TwinContact } from "./contact";
import { loadTwinRobot, type LoadedTwin } from "./loadTwinRobot";
import { frameScene, studioTone, toThree, type TwinLook } from "./looks";
import { applyJoints, binParts, boneSegments, CUBE_SIZE, FRANKA, gripperLinkSet, matLines, quat, TABLE } from "./model";
import type { TwinObject } from "./messages";
import type { TwinPose, TwinState, Vec3 } from "./types";
import "./twin.css";

// The hologram's colours (web/src/site/record/record-hologram.css, the .rg tokens).
const C = { void: "#040607", live: "#19F5C2", needle: "#FF5A1F", hold: "#FFB000", cube: "#D9D8D2", ink3: "#53625F" };
// A plan's cube colours (demo_pipeline.scene_plan COLORS), a little muted for the hologram.
const PLAN_COLORS: Record<string, string> = {
  red: "#C9302C", blue: "#2F5BC8", green: "#2E9E44", yellow: "#E5C840", orange: "#E07A1F", purple: "#7E3FA8", white: "#E8E8E4", black: "#2A2A2A",
};
const samePlace = (a: TwinPose, b: TwinPose | null) => !!b && a.pos.every((v, i) => Math.abs(v - b.pos[i]) < 1e-6);

const matte = new MeshStandardMaterial({ color: "#1B2427", roughness: 0.82, metalness: 0.12 });
const matteHot = new MeshStandardMaterial({ color: "#2A1A14", roughness: 0.7, metalness: 0.1, emissive: C.needle, emissiveIntensity: 0.18 });
const edge = new LineBasicMaterial({ color: C.live, transparent: true, opacity: 0.5 });
const edgeHot = new LineBasicMaterial({ color: C.needle, transparent: true, opacity: 0.95 });
// The contact glow (./contact.ts): the link that pushes on the bin or table, amber from a touch, red over 5 N.
const glowMatte = new MeshStandardMaterial({ color: "#2A1D0A", roughness: 0.6, metalness: 0.1, emissive: GLOW.touch, emissiveIntensity: 0.5 });
const glowEdge = new LineBasicMaterial({ color: GLOW.touch, transparent: true, opacity: 1 });
// The studio look: the Franka's white links and dark wrist and fingers; the edges only a whisper of teal.
const studioWhite = new MeshStandardMaterial({ color: "#E2E6E4", roughness: 0.42, metalness: 0.04 });
const studioDark = new MeshStandardMaterial({ color: "#2A3033", roughness: 0.5, metalness: 0.25 });
const studioHot = new MeshStandardMaterial({ color: "#3A2A24", roughness: 0.5, metalness: 0.2, emissive: C.needle, emissiveIntensity: 0.35 });
const studioEdge = new LineBasicMaterial({ color: C.live, transparent: true, opacity: 0.1 });
const SHARED: Material[] = [matte, matteHot, edge, edgeHot, glowMatte, glowEdge, studioWhite, studioDark, studioHot, studioEdge];
// Each mesh keeps its resting materials (userData.base, .hot, .edge), so the gripper and the glow put them back.
const baseOf = (o: { userData: Record<string, unknown> }) => (o.userData.base as Material | undefined) ?? matte;
const hotOf = (o: { userData: Record<string, unknown> }) => (o.userData.hot as Material | undefined) ?? matteHot;
const edgeOf = (o: { userData: Record<string, unknown> }) => (o.userData.edge as Material | undefined) ?? edge;

const ownerLink = (o: { parent: unknown }): URDFLink | null => {
  for (let p = o as { parent: unknown; isURDFLink?: boolean } | null; p; p = p.parent as typeof p)
    if (p.isURDFLink) return p as unknown as URDFLink;
  return null;
};

/** Matte meshes with thin edges (studio: the Franka's paint); the stick figure when the meshes didn't load. Done
 *  once per loaded robot. */
function dress({ robot, stick }: LoadedTwin, look: TwinLook = "hologram"): void {
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
  const studio = look === "studio";
  for (const m of meshes) {
    const base = studio ? (studioTone(ownerLink(m)?.name) === "dark" ? studioDark : studioWhite) : matte;
    m.material = base;
    m.userData.base = base;
    m.userData.hot = studio ? studioHot : matteHot;
    if (stick) continue; // capsules read as shapes; edges on them are noise
    const lines = new LineSegments(new EdgesGeometry(m.geometry as BufferGeometry, 28), studio ? studioEdge : edge);
    lines.userData.edge = studio ? studioEdge : edge;
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

/** Poses the robot, paints the gripper and the contact glow; asks for one frame only when something changed. */
function Robot({ loaded, joints, gripper, contact }: { loaded: LoadedTwin; joints: Record<string, number> | null; gripper: 0 | 1 | null; contact: TwinContact | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const { robot } = loaded;
  const hot = useMemo(() => gripperLinkSet(robot), [robot]);
  const glow = contactGlow(contact?.forceN ?? 0);
  const glowLink = glow.color && contact?.body ? robot.links[contact.body] ?? null : null; // unknown names glow nothing

  useEffect(() => {
    applyJoints(robot, joints ?? FRANKA.rest); // the aids may have posed it already (toolInEnv)
    invalidate();
  }, [robot, joints, invalidate]);

  useEffect(() => {
    if (glow.color) {
      glowMatte.emissive.set(glow.color);
      glowMatte.emissiveIntensity = glow.intensity;
      glowEdge.color.set(glow.color);
    }
    const closed = gripper === 1;
    robot.traverse((o) => {
      const link = ownerLink(o);
      if (!link) return;
      const lit = link === glowLink;
      if (!lit && !hot.has(link)) {
        if ((o as Mesh).isMesh && (o as Mesh).material === glowMatte) (o as Mesh).material = baseOf(o); // the glow moved on
        else if (o.userData.edge && (o as LineSegments).material === glowEdge) (o as LineSegments).material = edgeOf(o);
        return;
      }
      if ((o as Mesh).isMesh) (o as Mesh).material = lit ? glowMatte : closed ? hotOf(o) : baseOf(o);
      else if (o.userData.edge) (o as LineSegments).material = lit ? glowEdge : closed ? edgeHot : edgeOf(o);
    });
    invalidate();
  }, [robot, hot, gripper, glowLink, glow.color, glow.intensity, invalidate]);

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

function Table({ studio = false }: { studio?: boolean }) {
  const box = useMemo(() => new BoxGeometry(...TABLE.size), []);
  const edges = useMemo(() => new EdgesGeometry(box), [box]);
  return (
    <group position={TABLE.center}>
      <mesh geometry={box}>
        <meshStandardMaterial color={studio ? "#1A2427" : "#0A1012"} roughness={studio ? 0.8 : 0.95} metalness={0} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={C.live} transparent opacity={0.28} />
      </lineSegments>
    </group>
  );
}

/** inner: a plan's bin (the scene picker); today's BIN_INNER without one. */
function Bin({ pose, glow, inner, studio = false }: { pose: TwinPose; glow: boolean; inner?: [number, number, number]; studio?: boolean }) {
  const key = inner?.join(",");
  const parts = useMemo(
    () =>
      binParts(inner).map((p) => {
        const g = new BoxGeometry(...p.size);
        return { ...p, g, e: new EdgesGeometry(g) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return (
    <group position={pose.pos} quaternion={quat(pose.quat)}>
      {parts.map((p) => (
        <group key={p.name} position={p.center}>
          <mesh geometry={p.g}>
            {/* studio: the sim's blue bin */}
            <meshStandardMaterial color={studio ? "#22407F" : "#17130A"} roughness={studio ? 0.6 : 0.9} transparent opacity={studio ? 0.92 : 0.85} />
          </mesh>
          <lineSegments geometry={p.e}>
            <lineBasicMaterial color={studio ? "#8FB0FF" : C.hold} transparent opacity={glow ? 1 : studio ? 0.6 : 0.75} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** glow: lined up (the aids), its edges go from white to the live colour. A plan's cube (the scene picker) has its
 *  own size and colour; today's is CUBE_SIZE in the hologram's light grey. */
function Cube({ pose, glow, size = CUBE_SIZE, color }: { pose: TwinPose; glow: boolean; size?: number; color?: string }) {
  const box = useMemo(() => new BoxGeometry(size, size, size), [size]);
  const edges = useMemo(() => new EdgesGeometry(box), [box]);
  return (
    <group position={pose.pos} quaternion={quat(pose.quat)}>
      <mesh geometry={box}>
        <meshStandardMaterial color={color ? (PLAN_COLORS[color] ?? C.cube) : C.cube} roughness={0.75} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={glow ? C.live : "#FFFFFF"} transparent opacity={glow ? 0.95 : 0.5} />
      </lineSegments>
    </group>
  );
}

export type TwinTrail = {
  /** The path, in the sim's frame. */
  points: Vec3[];
  /** Drawn brightly up to this point (inclusive); the rest faintly. */
  upto: number;
  color: string;
  /** An estimate, not a recording: dashed. */
  dashed?: boolean;
};

/** A path: faint in full, bright up to now. Two lines; only the bright one's draw range changes per step. */
function Trail({ points, upto, color, dashed = false }: TwinTrail) {
  const invalidate = useThree((s) => s.invalidate);
  const lines = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
    const mat = (opacity: number) =>
      dashed
        ? new LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.012, gapSize: 0.01, depthWrite: false })
        : new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const all = new Line(g, mat(0.18));
    const done = new Line(g.clone(), mat(0.85));
    if (dashed) {
      all.computeLineDistances();
      done.computeLineDistances();
    }
    return { all, done };
  }, [points, color, dashed]);
  useEffect(
    () => () => {
      for (const l of [lines.all, lines.done]) {
        l.geometry.dispose();
        (l.material as Material).dispose();
      }
    },
    [lines],
  );
  useEffect(() => {
    lines.done.geometry.setDrawRange(0, Math.max(0, Math.min(points.length, upto + 1)));
    invalidate();
  }, [lines, upto, points.length, invalidate]);
  return (
    <>
      <primitive object={lines.all} />
      <primitive object={lines.done} />
    </>
  );
}

/** The operator's view: behind the robot, high and a little to its right, looking down the table (the robot's left
 *  on the left, as in the mirrored camera). Straight behind, the arm hid the cube and bin. A narrow pane steps back
 *  so the table still fits. Drag to turn, scroll to zoom. */
function View({ interactive, aspect: fixed, dom, facing = false, frame }: { interactive: boolean; aspect?: number; dom?: HTMLElement | null; facing?: boolean; frame?: Vec3[] | null }) {
  const whole = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const aspect = fixed ?? whole;
  // framePoints (./looks.ts frameScene): a wide view that fits them all
  const wide = useMemo(() => (frame && frame.length ? frameScene(frame, aspect) : null), [frame, aspect]);
  // three.js is y up; the sim is z up: (x, y, z)_sim -> (x, z, -y)_three
  const target = useMemo(() => (wide ? new Vector3(...toThree(wide.target)) : new Vector3(0.42, 0.08, 0)), [wide]);
  const position = useMemo(() => {
    if (wide) return new Vector3(...toThree(wide.position));
    const back = Math.max(1, 1.25 / aspect);
    // facing (the mirror mapping): the same view from the front, over the robot's left, so your right is still on the right
    return target.clone().add(new Vector3(facing ? 0.8 : -0.8, 1.25, facing ? -0.5 : 0.5).multiplyScalar(back));
  }, [aspect, target, facing, wide]);
  return (
    <>
      <PerspectiveCamera makeDefault manual={fixed !== undefined} position={position} fov={38} near={0.02} far={20} />
      <OrbitControls makeDefault domElement={dom ?? undefined} target={target} enabled={interactive} enableDamping={false} enablePan={false} minDistance={0.5} maxDistance={wide ? 6 : 4} maxPolarAngle={Math.PI * 0.49} />
    </>
  );
}

type Aiding = { aspect: number; dom: HTMLElement | null; cube: boolean; bin: boolean; facing: boolean };

type Look = { look: TwinLook; frame: Vec3[] | null; trails: TwinTrail[] | null; cubeColor?: string };

function Scene({ loaded, state, base, interactive, aids, contact, objects, viewKey, look }: { loaded: LoadedTwin; state: TwinState; base: TwinPose | null; interactive: boolean; aids: Aiding | null; contact: TwinContact | null; objects: TwinObject[] | null; viewKey: number; look: Look }) {
  const studio = look.look === "studio";
  return (
    <>
      <color attach="background" args={[C.void]} />
      {studio ? (
        // a key from above the camera's shoulder, a cool fill from the other side, a teal rim from behind the arm
        <>
          <hemisphereLight args={["#DCE6E4", "#0A0F10", 0.85]} />
          <directionalLight position={[2.6, 3.4, -1.2]} intensity={2.1} color="#FFF3E6" />
          <directionalLight position={[1.2, 1.2, 2.4]} intensity={0.45} color="#BFD4FF" />
          <directionalLight position={[-2.6, 2.2, 0.8]} intensity={1.6} color="#8FEFDC" />
        </>
      ) : (
        <>
          <hemisphereLight args={["#B8D6D0", C.void, 0.65]} />
          <directionalLight position={[-1.5, 3, 1.5]} intensity={1.25} />
          <directionalLight position={[2.5, 1.2, -2]} intensity={0.5} color="#8FEFDC" />
        </>
      )}
      <View key={viewKey} interactive={interactive} aspect={aids?.aspect} dom={aids?.dom} facing={aids?.facing} frame={look.frame} />
      {aids && <ThreeViews facing={aids.facing} />}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Table studio={studio} />
        <Mat />
        {look.trails?.map((t, i) => <Trail key={i} {...t} />)}
        {objects ? (
          // a plan's scene: every bin and cube; the goal's pair (state.bin / state.cube) still glows with the aids
          objects.map((o) =>
            o.kind === "bin" ? (
              <Bin key={o.id} pose={o.pose} inner={o.inner} glow={samePlace(o.pose, state.bin) && (aids?.bin ?? false)} />
            ) : (
              <Cube key={o.id} pose={o.pose} size={o.size} color={o.color} glow={samePlace(o.pose, state.cube) && (aids?.cube ?? false)} />
            ),
          )
        ) : (
          <>
            {state.bin && <Bin pose={state.bin} glow={aids?.bin ?? false} studio={studio} />}
            {state.cube && <Cube pose={state.cube} glow={aids?.cube ?? false} color={look.cubeColor} />}
          </>
        )}
        <group position={base?.pos ?? [0, 0, 0]} quaternion={base ? quat(base.quat) : undefined}>
          <Robot loaded={loaded} joints={state.joints} gripper={state.gripper} contact={contact} />
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
  /** Recording aids: front, side and top views, and the top-down alignment grid (tool point to cube, or to the bin
   *  while carrying it). */
  aids?: boolean;
  /** The mirror mapping (the robot faces you): the main view, the top view and the grid turn round, so your right
   *  stays on the right of the screen. Default: from behind the robot (your right is its right). */
  facing?: boolean;
  /** The arm's push on the bin or table (live only): its link glows amber from a touch, red over 5 N (./contact.ts). */
  contact?: TwinContact | null;
  /** A plan's every cube and bin (the scene picker): drawn instead of the one cube and bin; the aids still use cube/bin. */
  objects?: TwinObject[] | null;
  /** Change it to put the camera back where it started (the test track's R). */
  viewKey?: number;
  /** "studio": the Franka's own paint under a key light and a rim (./looks.ts); default the hologram. Read once. */
  look?: TwinLook;
  /** Points (sim frame) a wide camera keeps in view, instead of the operator's view from behind the arm. */
  framePoints?: Vec3[] | null;
  /** Paths drawn in the scene (sim frame), faint in full and bright up to now. */
  trails?: TwinTrail[] | null;
  /** The one cube's colour (a plan colour name, e.g. "red"); default the hologram's grey. */
  cubeColor?: string;
  className?: string;
};

export default function RobotTwin({ joints, gripper, cube, bin, base = null, interactive = true, caption, className, aids = false, facing = false, contact = null, objects = null, viewKey = 0, look = "hologram", framePoints = null, trails = null, cubeColor }: RobotTwinProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [box, size] = useBox<HTMLDivElement>();
  const [frontEl, setFrontEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    loadTwinRobot().then(
      (loaded) => {
        if (!live) return dispose(loaded.robot);
        dress(loaded, look);
        setLoad({ status: "ready", loaded });
      },
      (e: Error) => live && setLoad({ status: "error", message: e.message }),
    );
    return () => {
      live = false;
    };
    // the look is read once: dress paints the robot when it loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => void (load.status === "ready" && dispose(load.loaded.robot)), [load]);

  const state = useMemo(() => ({ joints, gripper, cube, bin }), [joints, gripper, cube, bin]);
  const looks = useMemo<Look>(() => ({ look, frame: framePoints, trails, cubeColor }), [look, framePoints, trails, cubeColor]);
  const robot = aids && load.status === "ready" ? load.loaded.robot : null;
  const tool = useMemo(() => (robot ? toolInEnv(robot, joints, base) : null), [robot, joints, base]);
  const align = useMemo(() => alignState(tool, cube, bin, gripper), [tool, cube, bin, gripper]);
  const layout = aids ? viewLayout(size.w, size.h) : null;
  const aiding = useMemo<Aiding | null>(
    () =>
      layout && {
        aspect: layout.front.w / Math.max(1, layout.front.h),
        dom: frontEl,
        cube: align?.kind === "cube" && align.aligned,
        bin: align?.kind === "bin" && align.aligned,
        facing,
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout?.front.w, layout?.front.h, frontEl, align?.kind, align?.aligned, facing],
  );
  const note =
    load.status === "ready" && load.loaded.stick
      ? `Stick figure: ${load.loaded.meshes.failed.length} of the robot's meshes didn't load.`
      : null;

  return (
    <div className={["twin3d", className].filter(Boolean).join(" ")} ref={box}>
      {load.status === "ready" ? (
        <Canvas className="twin3d__canvas" frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "low-power" }}>
          <Scene loaded={load.loaded} state={state} base={base} interactive={interactive} aids={aiding} contact={contact} objects={objects} viewKey={viewKey} look={looks} />
        </Canvas>
      ) : (
        <p className="twin3d__wait" role={load.status === "error" ? "alert" : undefined}>
          {load.status === "loading" ? "Loading the robot…" : `The robot didn't load: ${load.message}`}
        </p>
      )}
      {layout && load.status === "ready" && (
        <>
          <ViewCells front={layout.front} side={layout.side} top={layout.top} onFront={setFrontEl} facing={facing} />
          <AlignGrid rect={layout.align} align={align} cube={cube} bin={bin} gripper={gripper} facing={facing} />
        </>
      )}
      {(caption || note) && (
        <p className="twin3d__caption" style={layout ? { bottom: size.h - layout.front.h + 8 } : undefined}>
          {caption}
          {note && <span className="twin3d__note">{note}</span>}
        </p>
      )}
    </div>
  );
}
