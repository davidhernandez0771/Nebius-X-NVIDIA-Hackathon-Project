// The bench in 3D: the cartridge being made stands on the turntable, wearing the draft's label and
// shell (cartridge.glb's parts, as the machine draws its own), and the label printer slides a printed
// label out onto its tray when one is saved. Both are drawn only while the bench is open, so the room
// view's draw calls stay as they were; the cartridge grows in as the camera arrives.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldAnimating, useWorldState } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { CARTRIDGE_URL } from "../../scene/assets";
import { cartridgeParts, labelAtlas, offRedraw } from "../../scene/cartridge";
import { drawSingle } from "../../scene/labels";
import { liveMaterial, trackLive } from "../../scene/materials";
import { shellOf } from "../../scene/saved";
import { bench, draftLabel, subscribeBench } from "./draft";
import { BENCH_SCALE, PAPER, PRINT_H, PRINT_S, PRINT_W, benchCartridge, printPose } from "./layout";

/** The bench is seen close: its labels print at twice a spiral tile's size. */
const LABEL_SCALE = 2;
/** Smoke is the one see-through shell. */
const SMOKE_OPACITY = 0.72;
const GROW_S = 0.45;

type ShellMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

function useBenchCartridge(tier: StationSceneProps["quality"]) {
  const gltf = useGLTF(CARTRIDGE_URL, false);
  return useMemo(() => {
    const group = new THREE.Group();
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
    /** Put the draft on: its label printed, its shell's plastic (Smoke see-through). */
    const dress = () => {
      drawSingle(canvas, draftLabel(), LABEL_SCALE);
      label.needsUpdate = true;
      if (!shell) return;
      const look = shellOf(bench.draft.shell);
      shell.color.set(look.hex);
      const smoke = look.id === "smoke";
      if (shell.transparent !== smoke) {
        shell.transparent = smoke;
        shell.depthWrite = !smoke;
        shell.needsUpdate = true;
      }
      shell.opacity = smoke ? SMOKE_OPACITY : 1;
    };
    dress();
    return { group, dress, releases };
  }, [gltf, tier]);
}

function usePrintedLabel() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const geometry = new THREE.PlaneGeometry(PRINT_W, PRINT_H).rotateX(-Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ map, color: "#ffffff" });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.copy(PAPER.quaternion);
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

export function WorkbenchScene({ quality, reduced }: StationSceneProps) {
  const open = useWorldState((c) => c.branch === "workbench");
  const invalidate = useThree((s) => s.invalidate);
  const cart = useBenchCartridge(quality);
  const printed = usePrintedLabel();
  const holder = useRef<THREE.Group>(null);
  const home = useMemo(() => benchCartridge(), []);
  const st = useRef({ openedAt: -1, edits: bench.edits, editAt: -1, prints: bench.prints, printAt: -1 });
  // A slow sway on the turntable while the bench is open (high and ultra only, never reduced).
  useWorldAnimating(open && !reduced);

  useEffect(() => {
    const redraw = () => {
      cart.dress();
      printed.print();
      invalidate();
    };
    // The real fonts arriving redraw both labels, as they do the atlas.
    labelAtlas(redraw);
    const off = subscribeBench(() => {
      cart.dress();
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
    g.visible = open;
    if (!open) {
      s.openedAt = -1;
      printed.mesh.visible = false;
      return;
    }
    if (s.openedAt < 0) s.openedAt = now;
    let busy = false;

    // Growing in as the camera arrives.
    const grow = reduced ? 1 : Math.min(1, (now - s.openedAt) / GROW_S);
    const k = 1 - (1 - grow) ** 3;
    cart.group.scale.setScalar(BENCH_SCALE * (0.001 + 0.999 * k));
    busy ||= grow < 1;

    // A change to the draft: a quick turn on the turntable, settling back.
    if (s.edits !== bench.edits) {
      s.edits = bench.edits;
      s.editAt = now;
    }
    const since = now - s.editAt;
    const wiggle = reduced || s.editAt < 0 || since > 1 ? 0 : 0.2 * Math.exp(-5 * since) * Math.sin(13 * since);
    busy ||= wiggle !== 0;
    const sway = reduced || !quality.idleMotion ? 0 : 0.07 * Math.sin(now * 0.55);
    cart.group.rotation.y = home.yaw + wiggle + sway;

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
      <primitive object={cart.group} position={home.position} />
      <primitive object={printed.mesh} />
    </group>
  );
}
