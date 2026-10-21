// The bench in 3D. In the room view the draft stands on the turntable as one of the spiral's
// instances (Helix, its label the atlas's draft tile, reprinted here when the bench closes on a
// changed draft). Open, the bench is where the cartridge is made, stage by stage (draft.ts):
// - Material: six blank shells lie in a row on the mat, one per finish (one instanced draw for five,
//   one for the see-through one, one for their insides). The pointer (or the editor's radio) lifts one;
//   a pick flies it up, standing, onto the turntable; picking another flies the first back to its place.
// - Colour: the shell eases to the new colour.
// - Robot: the robot's hologram (holoMesh.ts) materializes on the cartridge's top, and again at each change.
//   It fades when the stage moves on.
// - Name: when the typing pauses, the print head runs down the label, printing the name.
// - Finish: it clicks into the turntable, a light crosses its shell, sparks pop, the printer slides its
//   label out, and it flies off to its empty place on the spiral (finale.ts). The turntable is left empty.
// All of it is drawn only while the bench is open, so the room view's draw calls stay as they were.
// Reduced motion: every change lands at once (no flights, no sweep, no sparks; the camera cuts).
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useWorld, useWorldAnimating, useWorldState } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { CARTRIDGE_URL } from "../../scene/assets";
import { cartridgeParts, labelAtlas, offRedraw, redrawDraftTile, type Part } from "../../scene/cartridge";
import { drawSingle, type LabelArt } from "../../scene/labels";
import { BENCH_PIVOT } from "../../scene/layout";
import { liveMaterial, trackLive } from "../../scene/materials";
import { FINISHES, finishOf, savedCartridges, type FinishId } from "../../scene/saved";
import { bench, draftLabel, endFlight, pickFinish, setHover, subscribeBench } from "./draft";
import { FINALE, finaleAt, popParticle, printWipe } from "./finale";
import { makeHoloRobot } from "./holoMesh";
import { BENCH_SCALE, HOLO_BASE, PICK_S, PRINT_H, PRINT_QUATERNION, PRINT_S, PRINT_W, benchCartridge, blankPose, flightPose, pickPose, printPose, type FlightPose } from "./layout";
import { robotHoloGeometry } from "./robotHolo";
import { applyFinish, finishAttribute, withFinish, withPrintHead, type FinishUniforms } from "./shellSurface";

/** The bench is seen close: its labels print at twice a spiral tile's size. */
const LABEL_SCALE = 2;
/** Opening onto a cartridge already made: the turntable turns it a whole turn round to you. */
const TURN_S = 1.1;
const TURN_LIFT = 0.12;
/** The shell's colour eases to a new one at this rate (1/s): about a quarter second. */
const COLOUR_RATE = 12;
/** A blank lifts and settles under the pointer at this rate. */
const LIFT_RATE = 16;
/** A blank coming back to its place on the mat drops in over this long. */
const DROP_S = 0.38;
/** The name prints once the typing has paused this long. */
const PRINT_PAUSE_S = 0.45;
/** The hologram materializes over this long. */
const REVEAL_S = 0.6;
const SPARKS = 72;

type ShellMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
const ANCHOR = new THREE.Vector3(...BENCH_PIVOT.position);

/** A blank label: the paper, before the print head has been over it. */
const BLANK_ART: LabelArt = { band: "SANT  ·  YOUR CARTRIDGE", code: "", line: "", mark: "rgba(0,0,0,0)", serial: "" };

/** A close cartridge: its label canvas behind the print head, and its shell in a finish and a colour. */
function makeCartridge(gltf: { scene: THREE.Object3D }, tier: StationSceneProps["quality"]) {
  const group = new THREE.Group();
  // Drawn at full size from the start: the warm-up may upload it hidden, and a texture whose canvas
  // grows after its first upload draws black.
  const canvas = document.createElement("canvas");
  drawSingle(canvas, BLANK_ART, LABEL_SCALE);
  const label = new THREE.CanvasTexture(canvas);
  label.colorSpace = THREE.SRGBColorSpace;
  label.anisotropy = 4;
  // The label mesh's v runs downward (as in the machine's copy, Scene.tsx dress).
  label.offset.set(0, 1);
  label.repeat.set(1, -1);
  const releases: (() => void)[] = [() => label.dispose()];
  let shell: ShellMaterial | null = null;
  let finishU: FinishUniforms | null = null;
  let wipe: { value: number } | null = null;
  for (const p of cartridgeParts(gltf.scene)) {
    const isLabel = p.name.startsWith("label");
    const isWindow = p.name.startsWith("window");
    const isShell = p.name.startsWith("shell");
    let m = liveMaterial(p.source, tier, isLabel ? { map: label, color: "#ffffff" } : isWindow ? { transparent: true, opacity: 0.35 } : isShell ? { color: "#ffffff" } : {});
    if (isShell) {
      const f = withFinish(m);
      m = f.material;
      finishU = f.uniforms;
      shell = m as ShellMaterial;
    }
    if (isLabel) wipe = withPrintHead(m).uniforms.uWipe;
    releases.push(trackLive(m));
    const mesh = new THREE.Mesh(p.geometry, m);
    mesh.raycast = () => {};
    group.add(mesh);
  }
  const colour = new THREE.Color();
  const target = new THREE.Color();
  return {
    group,
    colour,
    target,
    wipe: wipe ?? { value: 1 },
    /** Print `art` on its label (the print head shows it, Scene's frame). */
    print(art: LabelArt) {
      drawSingle(canvas, art, LABEL_SCALE);
      label.needsUpdate = true;
    },
    /** A finish, and the colour it eases toward (`now`: there at once). */
    look(finish: FinishId, hex: string, now = false) {
      if (shell && finishU) applyFinish(shell, finishU, finish);
      // Color.set reads hex as sRGB and keeps it linear.
      target.set(hex);
      if (now) colour.copy(target);
      shell?.color.copy(colour);
    },
    /** Eases the shell's colour; true while it is still on its way. */
    ease(k: number): boolean {
      if (!shell) return false;
      const d = Math.abs(colour.r - target.r) + Math.abs(colour.g - target.g) + Math.abs(colour.b - target.b);
      if (d < 0.002) {
        colour.copy(target);
        shell.color.copy(colour);
        return false;
      }
      colour.lerp(target, k);
      shell.color.copy(colour);
      return true;
    },
    sweep(v: number) {
      if (finishU) finishU.uSweep.value = v;
    },
    releases,
  };
}

/** The six blanks on the mat: the five opaque ones as one instanced draw, the see-through one alone, their insides as one. */
function makeRow(parts: Part[], tier: StationSceneProps["quality"]) {
  const shellPart = parts.find((p) => p.name.startsWith("shell"))!;
  const opaqueIds = FINISHES.map((f, i) => (f.opacity < 1 ? -1 : i)).filter((i) => i >= 0);
  const clearId = FINISHES.findIndex((f) => f.opacity < 1);

  const opaqueGeo = shellPart.geometry.clone();
  opaqueGeo.setAttribute("aFinish", new THREE.InstancedBufferAttribute(new Float32Array(opaqueIds.flatMap((i) => finishAttribute(FINISHES[i].id))), 4));
  const opaqueMat = withFinish(liveMaterial(shellPart.source, tier, { color: "#ffffff" }), true).material;
  const opaque = new THREE.InstancedMesh(opaqueGeo, opaqueMat, opaqueIds.length);
  opaqueIds.forEach((id, k) => opaque.setColorAt(k, new THREE.Color(FINISHES[id].color)));
  opaque.frustumCulled = false;
  opaque.name = "bench:row";

  const clear = withFinish(liveMaterial(shellPart.source, tier, { color: FINISHES[clearId].color }));
  applyFinish(clear.material as ShellMaterial, clear.uniforms, FINISHES[clearId].id);
  const clearMesh = new THREE.Mesh(shellPart.geometry, clear.material);
  clearMesh.name = "bench:clear";

  // Their insides (the window's back, the reels, the tape, the pins, the screw) in their own colours, merged.
  const inside = parts.filter((p) => /^(inner|reels|tape|pins|screw)/.test(p.name));
  const geos = inside.map((p) => {
    const g = p.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    const c = (p.source as THREE.MeshStandardMaterial).color ?? new THREE.Color(0.5, 0.5, 0.5);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  });
  const insideGeo = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const insideMat = tier.name === "low" ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  const insides = new THREE.InstancedMesh(insideGeo, insideMat, FINISHES.length);
  insides.raycast = () => {};
  insides.frustumCulled = false;

  return {
    opaque,
    opaqueIds,
    clearMesh,
    clearId,
    insides,
    release: () => {
      opaqueGeo.dispose();
      opaqueMat.dispose();
      clear.material.dispose();
      insideGeo.dispose();
      insideMat.dispose();
    },
  };
}

function useBench(tier: StationSceneProps["quality"]) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  return useMemo(() => {
    const main = makeCartridge(gltf, tier);
    const flying = makeCartridge(gltf, tier);
    flying.group.visible = false;
    main.group.visible = false;
    const row = makeRow(cartridgeParts(gltf.scene), tier);
    const holo = makeHoloRobot();
    return { main, flying, row, holo, releases: [...main.releases, ...flying.releases, row.release, () => holo.dispose()] };
  }, [gltf, tier]);
}

function usePrintedLabel() {
  return useMemo(() => {
    // Full size from the start, like the cartridges' labels (makeCartridge).
    const canvas = document.createElement("canvas");
    drawSingle(canvas, draftLabel(), LABEL_SCALE);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const geometry = new THREE.PlaneGeometry(PRINT_W, PRINT_H).rotateX(-Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ map, color: "#ffffff" });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.copy(PRINT_QUATERNION);
    mesh.raycast = () => {};
    mesh.visible = false;
    const print = () => {
      if (!bench.printed) return;
      drawSingle(canvas, bench.printed, LABEL_SCALE);
      map.needsUpdate = true;
    };
    return { mesh, print, release: () => (geometry.dispose(), material.dispose(), map.dispose()) };
  }, []);
}

/** The finish's sparks: one points draw, only while they fly. */
function useSparks() {
  return useMemo(() => {
    const pos = new Float32Array(SPARKS * 3);
    const alpha = new Float32Array(SPARKS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uPR;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPR * 34.0 / max(0.5, -mv.z), 1.5, 9.0 * uPR);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c) * 4.0;
          if (r > 1.0) discard;
          float a = (1.0 - r) * (1.0 - r) * vA;
          vec3 col = mix(vec3(0.1, 0.96, 0.76), vec3(1.0), (1.0 - r) * 0.6);
          gl_FragColor = vec4(col * a * 1.6, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.raycast = () => {};
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 12;
    const at = (u: number, centre: THREE.Vector3) => {
      for (let i = 0; i < SPARKS; i++) {
        const p = popParticle(i + 1, u);
        pos.set([centre.x + p.x, centre.y + p.y, centre.z + p.z], i * 3);
        alpha[i] = p.alpha;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    };
    return { points, material, at, release: () => (geometry.dispose(), material.dispose()) };
  }, []);
}

/** The room view's copy of the draft (the atlas's draft tile): reprinted only when it changed and the bench is shut. */
function useRoomTile(open: boolean) {
  const drawn = useRef("");
  useEffect(() => {
    const sync = () => {
      if (open) return;
      const art = draftLabel();
      const key = JSON.stringify(art);
      if (key === drawn.current) return;
      drawn.current = key;
      redrawDraftTile(art);
    };
    sync();
    return subscribeBench(sync);
  }, [open]);
}

/** The twin's Franka, as the robot wall stands it (its meshes load once, with urdf-loader, on first use). */
let frankaArm: Promise<THREE.BufferGeometry | null> | null = null;
function loadFrankaArm(): Promise<THREE.BufferGeometry | null> {
  frankaArm ??= Promise.all([import("../../../twin/loadTwinRobot"), import("../../scene/wallParts")])
    .then(([twin, wall]) => twin.loadTwinRobot().then((t) => (t.stick ? null : wall.frankaPieces(t.robot).arm)))
    .catch((e) => {
      console.warn("world: the Franka's meshes didn't load for the bench's hologram", e);
      return null;
    });
  return frankaArm;
}

const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const inOut = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function WorkbenchScene({ quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const open = useWorldState((c) => c.branch === "workbench");
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const b = useBench(quality);
  const printed = usePrintedLabel();
  const sparks = useSparks();
  const holder = useRef<THREE.Group>(null);
  const home = useMemo(() => benchCartridge(), []);
  const pose = useMemo<FlightPose>(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 }), []);
  const st = useRef({
    openedAt: -1,
    /** The finish on the turntable now (null: empty). */
    onTable: null as FinishId | null,
    picks: bench.picks,
    pickAt: -1,
    pickFrom: -1,
    /** A blank flying back to its place on the mat (its finish index), and when it left. */
    backTo: -1,
    backAt: -1,
    lift: new Float32Array(FINISHES.length),
    /** When each blank came back to the mat (it drops in), or -1. */
    dropAt: new Float32Array(FINISHES.length).fill(-1),
    away: FINISHES.map(() => false),
    robot: "",
    robotAt: -1,
    holoLevel: 0,
    name: bench.draft.name,
    nameAt: -1,
    printAt: -1,
    printedName: "",
    prints: bench.prints,
    labelAt: -1,
    flights: bench.flights,
    finaleAt: -1,
    place: -1,
    edits: bench.edits,
    editAt: -1,
  });
  // A slow turn of the hologram while the bench is open (high and ultra only, never reduced).
  useWorldAnimating(open && !reduced && quality.idleMotion);
  useRoomTile(open);

  // Everything on the bench follows the draft; the real fonts arriving reprint the labels.
  useEffect(() => {
    const redraw = () => {
      if (st.current.printedName) b.main.print(draftLabel());
      printed.print();
      invalidate();
    };
    labelAtlas(redraw);
    const off = subscribeBench(invalidate);
    return () => {
      off();
      offRedraw(redraw);
    };
  }, [b, printed, invalidate]);
  useEffect(() => () => b.releases.forEach((r) => r()), [b]);
  useEffect(() => () => printed.release(), [printed]);
  useEffect(() => () => sparks.release(), [sparks]);

  // The hologram's robot: the stand-ins at once, the Franka once its meshes are in.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const show = (arm: THREE.BufferGeometry | null) => {
      if (!live) return;
      b.holo.setRobot(robotHoloGeometry(bench.draft.robot, arm));
      invalidate();
    };
    let arm: THREE.BufferGeometry | null = null;
    show(null);
    void loadFrankaArm().then((g) => {
      arm = g;
      show(arm);
    });
    let robot = bench.draft.robot;
    const off = subscribeBench(() => {
      if (bench.draft.robot === robot) return;
      robot = bench.draft.robot;
      show(arm);
    });
    return () => {
      live = false;
      off();
    };
  }, [open, b, invalidate]);

  // Pointing at the blanks on the mat (the material stage only).
  const blankAt = (e: ThreeEvent<PointerEvent | MouseEvent>, object: THREE.Object3D) => (object === b.row.clearMesh ? b.row.clearId : e.instanceId !== undefined ? b.row.opaqueIds[e.instanceId] : -1);
  const pickable = () => store.getCoarse().branch === "workbench" && bench.stage === "material";
  const rowEvents = (object: THREE.Object3D) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (!pickable()) return;
      e.stopPropagation();
      const i = blankAt(e, object);
      if (i >= 0 && st.current.away[i]) return setHover(-1);
      setHover(i);
      document.body.style.cursor = i >= 0 ? "pointer" : "";
    },
    onPointerOut: () => {
      setHover(-1);
      document.body.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!pickable()) return;
      const i = blankAt(e, object);
      if (i < 0 || st.current.away[i]) return;
      e.stopPropagation();
      pickFinish(FINISHES[i].id);
    },
  });

  useFrame(({ clock }, delta) => {
    const g = holder.current;
    if (!g) return;
    const s = st.current;
    const now = clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    // The store, not React's copy: the room view's instance (Helix) hides on this same frame.
    const isOpen = store.getCoarse().branch === "workbench";
    g.visible = isOpen;
    const main = b.main;
    const flying = b.flying;
    if (!isOpen) {
      s.openedAt = -1;
      // Whatever was in the air has landed.
      s.picks = bench.picks;
      s.pickAt = s.backAt = s.finaleAt = -1;
      s.backTo = -1;
      s.flights = bench.flights;
      s.edits = bench.edits;
      s.dropAt.fill(-1);
      s.onTable = null;
      flying.group.visible = false;
      printed.mesh.visible = false;
      sparks.points.visible = false;
      return;
    }
    let busy = false;
    const d = bench.draft;
    if (s.openedAt < 0) {
      // Opening: the turntable holds the draft's blank as it was left, the label as it was printed.
      s.openedAt = now;
      s.onTable = d.finish;
      if (d.finish) main.look(d.finish, d.color, true);
      s.name = s.printedName = d.name.trim();
      main.print(s.printedName ? draftLabel() : BLANK_ART);
      main.wipe.value = s.printedName ? 1 : 0;
      s.robot = d.robot;
      s.robotAt = now;
      s.holoLevel = 0;
    }

    // ---- Material: picks ----
    if (s.picks !== bench.picks) {
      s.picks = bench.picks;
      const was = s.onTable;
      const next = d.finish;
      if (was && was !== next && !reduced) {
        // The one on the turntable goes back to its place on the mat.
        s.backTo = FINISHES.findIndex((f) => f.id === was);
        s.backAt = now;
        flying.look(was, finishOf(was).color, true);
        flying.print(BLANK_ART);
        flying.wipe.value = 0;
      } else if (was && was !== next) s.dropAt[FINISHES.findIndex((f) => f.id === was)] = now;
      s.onTable = next;
      if (next) {
        s.pickFrom = FINISHES.findIndex((f) => f.id === next);
        s.pickAt = reduced ? -1 : now;
        main.look(next, d.color, true);
      }
    }
    // A fresh start (Make another) empties the turntable; its blank drops back onto the mat.
    if (s.onTable && !d.finish && s.finaleAt < 0) {
      s.dropAt[FINISHES.findIndex((f) => f.id === s.onTable)] = now;
      s.onTable = null;
    }
    if (d.finish && d.finish === s.onTable) main.look(d.finish, d.color);

    // ---- The finish ("pum") ----
    if (s.flights !== bench.flights) {
      s.flights = bench.flights;
      s.place = bench.landing;
      const c = savedCartridges()[s.place];
      if (s.place >= 0 && c && bench.printed) {
        s.finaleAt = now;
        flying.look(c.finish, c.color, true);
        flying.print(bench.printed);
        flying.wipe.value = 1;
      }
    }
    const fin = s.finaleAt >= 0 ? finaleAt(now - s.finaleAt, reduced) : null;

    // ---- The row of blanks on the mat ----
    const usedByTable = s.onTable ? FINISHES.findIndex((f) => f.id === s.onTable) : -1;
    for (let i = 0; i < FINISHES.length; i++) {
      // Off the mat: on the turntable (or saved from it, until Make another), or flying back.
      const away = i === usedByTable || i === s.backTo;
      if (s.away[i] && !away && s.dropAt[i] < 0 && !reduced) s.dropAt[i] = now;
      s.away[i] = away;
      const want = !away && bench.hover === i && bench.stage === "material" ? 1 : 0;
      const k = reduced ? 1 : 1 - Math.exp(-LIFT_RATE * dt);
      s.lift[i] += (want - s.lift[i]) * k;
      if (Math.abs(want - s.lift[i]) < 0.002) s.lift[i] = want;
      else busy = true;
      let drop = 0;
      if (s.dropAt[i] >= 0) {
        const u = (now - s.dropAt[i]) / DROP_S;
        if (u >= 1 || reduced) s.dropAt[i] = -1;
        else {
          drop = 1 - ease(u);
          busy = true;
        }
      }
      blankPose(i, s.lift[i] + drop * 4, pose);
      const m = away ? HIDDEN : _m.compose(pose.position, pose.quaternion, _s.setScalar(pose.scale * (1 - 0.12 * drop)));
      const k2 = b.row.opaqueIds.indexOf(i);
      if (k2 >= 0) b.row.opaque.setMatrixAt(k2, m);
      else {
        b.row.clearMesh.visible = !away;
        if (!away) {
          b.row.clearMesh.position.copy(pose.position);
          b.row.clearMesh.quaternion.copy(pose.quaternion);
          b.row.clearMesh.scale.setScalar(pose.scale * (1 - 0.12 * drop));
        }
      }
      b.row.insides.setMatrixAt(i, m);
    }
    b.row.opaque.instanceMatrix.needsUpdate = true;
    b.row.insides.instanceMatrix.needsUpdate = true;

    // A blank flying back to the mat (the flying copy; never while a save flies).
    if (s.backTo >= 0 && s.finaleAt < 0) {
      const u = (now - s.backAt) / PICK_S;
      if (u >= 1) {
        // Landed in its place by the flight itself: no drop-in after it.
        s.away[s.backTo] = false;
        s.backTo = -1;
        flying.group.visible = false;
      } else {
        pickPose(s.backTo, 1 - u, pose);
        flying.group.visible = true;
        flying.group.position.copy(pose.position);
        flying.group.quaternion.copy(pose.quaternion);
        flying.group.scale.setScalar(pose.scale);
        busy = true;
      }
    }

    // ---- The cartridge on the turntable ----
    const onTable = s.onTable !== null && (bench.stage !== "done" || (fin !== null && fin.fly === 0));
    main.group.visible = onTable && !(fin && fin.fly > 0);
    let y = home.position.y;
    let yaw = home.yaw;
    let scale = BENCH_SCALE;
    if (main.group.visible) {
      if (s.pickAt >= 0) {
        const u = (now - s.pickAt) / PICK_S;
        if (u >= 1) s.pickAt = -1;
        else {
          pickPose(s.pickFrom, u, pose);
          main.group.position.copy(pose.position);
          main.group.quaternion.copy(pose.quaternion);
          main.group.scale.setScalar(pose.scale);
          busy = true;
        }
      }
      if (s.pickAt < 0) {
        // Opening onto a made one: a whole turn round to you, lifting a little.
        const turn = reduced ? 1 : inOut((now - s.openedAt) / TURN_S);
        if (turn < 1) busy = true;
        y += TURN_LIFT * Math.sin(Math.PI * turn);
        yaw += 2 * Math.PI * turn;
        // A robot change: a quick turn on the turntable, settling back.
        if (s.edits !== bench.edits) {
          s.edits = bench.edits;
          if (s.robot !== d.robot) s.editAt = now;
        }
        const since = now - s.editAt;
        if (!reduced && s.editAt >= 0 && since <= 1) {
          yaw += 0.2 * Math.exp(-5 * since) * Math.sin(13 * since);
          busy = true;
        }
        let squash = 1;
        if (fin) {
          y += fin.press;
          squash = fin.squash;
          main.sweep(fin.sweep);
          if (fin.sweep > 0 && fin.sweep < 1) busy = true;
        } else main.sweep(0);
        main.group.position.set(home.position.x, y, home.position.z);
        main.group.quaternion.setFromAxisAngle(_c.set(0, 1, 0), yaw);
        main.group.scale.set(scale, scale * squash, scale);
      }
      if (main.ease(reduced ? 1 : 1 - Math.exp(-COLOUR_RATE * dt))) busy = true;
    }

    // ---- Name: the print head runs down the label once the typing pauses ----
    const name = d.name.trim();
    if (name !== s.name) {
      s.name = name;
      s.nameAt = now;
    }
    if (s.nameAt >= 0) {
      busy = true;
      if (!name) {
        s.nameAt = -1;
        s.printedName = "";
        main.wipe.value = 0;
      } else if (now - s.nameAt >= (reduced ? 0 : PRINT_PAUSE_S)) {
        s.nameAt = -1;
        if (name !== s.printedName) {
          s.printedName = name;
          main.print(draftLabel());
          s.printAt = reduced ? -1 : now;
        }
      }
    }
    if (s.printedName) {
      main.wipe.value = printWipe(s.printAt < 0 ? -1 : now - s.printAt);
      if (main.wipe.value < 1) busy = true;
    }

    // ---- The robot's hologram ----
    if (d.robot !== s.robot) {
      s.robot = d.robot;
      s.robotAt = now;
    }
    // On the robot stage only: the name's close shot would cut it off.
    const holoWant = onTable && bench.stage === "robot" ? 1 : 0;
    if (holoWant && s.holoLevel === 0) s.robotAt = now;
    const hk = reduced ? 1 : 1 - Math.exp(-(holoWant ? 6 : 14) * dt);
    s.holoLevel += (holoWant - s.holoLevel) * hk;
    if (Math.abs(holoWant - s.holoLevel) < 0.01) s.holoLevel = holoWant;
    else busy = true;
    const holo = b.holo;
    holo.mesh.visible = s.holoLevel > 0;
    if (holo.mesh.visible) {
      holo.uniforms.uLevel.value = s.holoLevel;
      const reveal = reduced ? 1 : ease((now - s.robotAt) / REVEAL_S);
      holo.uniforms.uReveal.value = reveal < 1 ? reveal : 1.01;
      if (reveal < 1) busy = true;
      holo.uniforms.uTime.value = now;
      holo.mesh.position.set(HOLO_BASE.x, HOLO_BASE.y + (y - home.position.y), HOLO_BASE.z);
      // Side on, reaching along the bench; turning slowly where the tier moves on its own.
      const spin = reduced || !quality.idleMotion ? 0 : now * 0.45;
      holo.mesh.rotation.y = BENCH_PIVOT.yaw + Math.PI / 2 + spin;
    }

    // ---- The finish: sparks, then the flight to the spiral ----
    if (fin) {
      sparks.points.visible = fin.pop > 0 && fin.pop < 1;
      if (sparks.points.visible) {
        sparks.material.uniforms.uPR.value = gl.getPixelRatio();
        sparks.at(fin.pop, _c.set(home.position.x, home.position.y - 0.35, home.position.z));
      }
      if (fin.fly > 0 && fin.fly < 1) {
        flightPose(s.place, fin.fly, pose);
        flying.group.visible = true;
        flying.group.position.copy(pose.position).sub(ANCHOR);
        flying.group.quaternion.copy(pose.quaternion);
        flying.group.scale.setScalar(pose.scale);
      } else if (s.backTo < 0) flying.group.visible = false;
      if (fin.done) {
        s.finaleAt = -1;
        flying.group.visible = false;
        sparks.points.visible = false;
        endFlight();
      } else busy = true;
    }

    // A save: the label slides out of the printer, a receipt.
    if (s.prints !== bench.prints) {
      s.prints = bench.prints;
      s.labelAt = now;
      printed.print();
    }
    printed.mesh.visible = !!bench.printed;
    if (bench.printed) {
      const u = reduced ? 1 : (now - s.labelAt - FINALE.sweepAt) / PRINT_S;
      printPose(Math.max(0, u), printed.mesh.position);
      if (u < 1) busy = true;
    }
    if (busy) invalidate();
  });

  return (
    <group ref={holder} visible={false} name="workbench">
      <primitive object={b.main.group} />
      <primitive object={b.flying.group} />
      <primitive object={b.row.opaque} {...rowEvents(b.row.opaque)} />
      <primitive object={b.row.clearMesh} {...rowEvents(b.row.clearMesh)} />
      <primitive object={b.row.insides} />
      <primitive object={b.holo.mesh} />
      <primitive object={sparks.points} />
      <primitive object={printed.mesh} />
    </group>
  );
}

