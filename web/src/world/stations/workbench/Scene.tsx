// The bench in 3D. In the room view the draft stands on the turntable as one of the spiral's
// instances (Helix, its label the atlas's draft tile, reprinted here when the bench closes on a
// changed draft). Open, the bench draws its own close copy in its place, wearing the draft's label and
// shell (cartridge.glb's parts, as the machine draws its own): the turntable turns it round to you as
// the camera arrives, and it gives a little turn at every edit. A save sends it flying off to its
// empty place on the spiral while the printer slides its label out, and a fresh blank grows on the
// turntable. The close copies are drawn only while the bench is open, so the room view's draw calls
// stay as they were.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWorld, useWorldAnimating, useWorldState } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { CARTRIDGE_URL } from "../../scene/assets";
import { cartridgeParts, labelAtlas, offRedraw, redrawDraftTile } from "../../scene/cartridge";
import { drawSingle, type LabelArt } from "../../scene/labels";
import { BENCH_PIVOT } from "../../scene/layout";
import { liveMaterial, trackLive } from "../../scene/materials";
import { savedCartridges, shellOf, type ShellId } from "../../scene/saved";
import { bench, draftLabel, endFlight, subscribeBench } from "./draft";
import { BENCH_SCALE, FLIGHT_S, PRINT_H, PRINT_QUATERNION, PRINT_S, PRINT_W, benchCartridge, flightPose, printPose, type FlightPose } from "./layout";

/** The bench is seen close: its labels print at twice a spiral tile's size. */
const LABEL_SCALE = 2;
/** Smoke is the one see-through shell. */
const SMOKE_OPACITY = 0.72;
/** Opening: the turntable turns it a whole turn round to you, lifting it a little on the way. */
const TURN_S = 1.1;
const TURN_LIFT = 0.12;
/** After a save, the fresh blank waits for the saved one to leave, then grows in. */
const GROW_AFTER_S = 0.45;
const GROW_S = 0.45;

type ShellMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
const ANCHOR = new THREE.Vector3(...BENCH_PIVOT.position);

/** A close cartridge with its own label canvas: dress() prints a label and puts a shell on it. */
function makeCartridge(gltf: { scene: THREE.Object3D }, tier: StationSceneProps["quality"]) {
  const group = new THREE.Group();
  // Drawn at full size from the start: the warm-up may upload it hidden, and a texture whose canvas
  // grows after its first upload draws black.
  const canvas = document.createElement("canvas");
  drawSingle(canvas, draftLabel(), LABEL_SCALE);
  const label = new THREE.CanvasTexture(canvas);
  label.colorSpace = THREE.SRGBColorSpace;
  label.anisotropy = 4;
  // The label mesh's v runs downward (as in the machine's copy, Scene.tsx dress).
  label.offset.set(0, 1);
  label.repeat.set(1, -1);
  const releases: (() => void)[] = [() => label.dispose()];
  let shell: ShellMaterial | null = null;
  for (const p of cartridgeParts(gltf.scene)) {
    const isLabel = p.name.startsWith("label");
    const isWindow = p.name.startsWith("window");
    const isShell = p.name.startsWith("shell");
    const m = liveMaterial(p.source, tier, isLabel ? { map: label, color: "#ffffff" } : isWindow ? { transparent: true, opacity: 0.35 } : isShell ? { color: "#ffffff" } : {});
    releases.push(trackLive(m));
    if (isShell) shell = m as ShellMaterial;
    const mesh = new THREE.Mesh(p.geometry, m);
    mesh.raycast = () => {};
    group.add(mesh);
  }
  /** Print `art` on it and put on the shell's plastic (Smoke see-through). */
  const dress = (art: LabelArt, shellId: ShellId) => {
    drawSingle(canvas, art, LABEL_SCALE);
    label.needsUpdate = true;
    if (!shell) return;
    const look = shellOf(shellId);
    shell.color.set(look.hex);
    const smoke = look.id === "smoke";
    if (shell.transparent !== smoke) {
      shell.transparent = smoke;
      shell.depthWrite = !smoke;
      shell.needsUpdate = true;
    }
    shell.opacity = smoke ? SMOKE_OPACITY : 1;
  };
  return { group, dress, releases };
}

function useBenchCartridges(tier: StationSceneProps["quality"]) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  return useMemo(() => {
    const main = makeCartridge(gltf, tier);
    main.dress(draftLabel(), bench.draft.shell);
    const flying = makeCartridge(gltf, tier);
    flying.group.visible = false;
    return { main, flying, releases: [...main.releases, ...flying.releases] };
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

const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const inOut = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export function WorkbenchScene({ quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const open = useWorldState((c) => c.branch === "workbench");
  const invalidate = useThree((s) => s.invalidate);
  const cart = useBenchCartridges(quality);
  const printed = usePrintedLabel();
  const holder = useRef<THREE.Group>(null);
  const home = useMemo(() => benchCartridge(), []);
  const st = useRef({
    openedAt: -1,
    edits: bench.edits,
    editAt: -1,
    prints: bench.prints,
    printAt: -1,
    flights: bench.flights,
    flightAt: -1,
    growAt: -1,
    place: -1,
    pose: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 } as FlightPose,
  });
  // A slow sway on the turntable while the bench is open (high and ultra only, never reduced).
  useWorldAnimating(open && !reduced);
  useRoomTile(open);

  useEffect(() => {
    const redraw = () => {
      cart.main.dress(draftLabel(), bench.draft.shell);
      printed.print();
      invalidate();
    };
    // The real fonts arriving redraw both labels, as they do the atlas.
    labelAtlas(redraw);
    const off = subscribeBench(() => {
      cart.main.dress(draftLabel(), bench.draft.shell);
      invalidate();
    });
    return () => {
      off();
      offRedraw(redraw);
    };
  }, [cart, printed, invalidate]);
  useEffect(() => () => cart.releases.forEach((r) => r()), [cart]);
  useEffect(() => () => printed.release(), [printed]);

  useFrame(({ clock }) => {
    const g = holder.current;
    if (!g) return;
    const s = st.current;
    const now = clock.elapsedTime;
    // The store, not React's copy: the room view's instance (Helix) hides on this same frame.
    const open = store.getCoarse().branch === "workbench";
    g.visible = open;
    const main = cart.main.group;
    const flying = cart.flying.group;
    if (!open) {
      s.openedAt = -1;
      // Opening isn't an edit (no wiggle on the way in), and a flight cut short has landed.
      s.edits = bench.edits;
      s.flights = bench.flights;
      s.flightAt = -1;
      s.growAt = -1;
      main.scale.setScalar(BENCH_SCALE);
      flying.visible = false;
      printed.mesh.visible = false;
      return;
    }
    if (s.openedAt < 0) s.openedAt = now;
    let busy = false;

    // A save: the saved one flies off to the spiral and a fresh blank grows in behind it.
    if (s.flights !== bench.flights) {
      s.flights = bench.flights;
      s.place = bench.landing;
      const c = savedCartridges()[s.place];
      if (s.place >= 0 && c && bench.printed) {
        s.flightAt = s.growAt = now;
        cart.flying.dress(bench.printed, c.shell);
      }
    }
    let grow = 1;
    if (s.flightAt >= 0) {
      const u = reduced ? 1 : (now - s.flightAt) / FLIGHT_S;
      flying.visible = u < 1;
      if (u < 1) {
        flightPose(s.place, u, s.pose);
        flying.position.copy(s.pose.position).sub(ANCHOR);
        flying.quaternion.copy(s.pose.quaternion);
        flying.scale.setScalar(s.pose.scale);
        busy = true;
      } else {
        s.flightAt = -1;
        endFlight();
      }
    }
    if (s.growAt >= 0) {
      grow = reduced ? 1 : ease((now - s.growAt - GROW_AFTER_S) / GROW_S);
      if (grow >= 1) s.growAt = -1;
      else busy = true;
    }
    main.scale.setScalar(BENCH_SCALE * (0.001 + 0.999 * grow));

    // Opening: a whole turn of the turntable, round to you, with a little lift.
    const turn = reduced ? 1 : inOut((now - s.openedAt) / TURN_S);
    busy ||= turn < 1;
    main.position.set(home.position.x, home.position.y + TURN_LIFT * Math.sin(Math.PI * turn), home.position.z);

    // A change to the draft: a quick turn on the turntable, settling back.
    if (s.edits !== bench.edits) {
      s.edits = bench.edits;
      s.editAt = now;
    }
    const since = now - s.editAt;
    const wiggling = !reduced && s.editAt >= 0 && since <= 1;
    const wiggle = wiggling ? 0.2 * Math.exp(-5 * since) * Math.sin(13 * since) : 0;
    busy ||= wiggling;
    const sway = reduced || !quality.idleMotion ? 0 : 0.07 * Math.sin(now * 0.55);
    main.rotation.y = home.yaw + 2 * Math.PI * turn + wiggle + sway;

    // A save: the label slides out of the printer.
    if (s.prints !== bench.prints) {
      s.prints = bench.prints;
      s.printAt = now;
      printed.print();
    }
    printed.mesh.visible = !!bench.printed;
    if (bench.printed) {
      const u = reduced ? 1 : (now - s.printAt) / PRINT_S;
      printPose(u, printed.mesh.position);
      busy ||= u < 1;
    }
    if (busy) invalidate();
  });

  return (
    <group ref={holder} visible={false} name="workbench">
      <primitive object={cart.main.group} />
      <primitive object={cart.flying.group} />
      <primitive object={printed.mesh} />
    </group>
  );
}
