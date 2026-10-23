// The workshop in 3D: the baked room around everything (unlit, one atlas per piece), the lamps that
// switch it on, the live lights and reflections for the moving parts, the spiral and the robot wall.
// Each file loads in its own Suspense. A cartridge can be dragged off the spiral onto the machine
// (Dragged.tsx), and the bench's draft stands on its turntable as one more of the spiral's instances. All of it materializes over the generator's particles during
// the workshop's travel (scene/dissolve.ts: revealAt), then the lamps flicker on.
import { Suspense, useCallback, useEffect, useMemo } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { BAKED } from "../../scene/assets";
import { Baked } from "../../scene/Baked";
import { cutBakedBody } from "../../scene/machineV2";
import { Arm } from "../../scene/Arm";
import { dissolve, FIELD_MAX, LAMPS_AT, revealAt } from "../../scene/dissolve";
import { Helix, type BenchInstance } from "../../scene/Helix";
import { Haze } from "../../scene/Haze";
import { Lamps } from "../../scene/Lamps";
import { Materialize } from "../../scene/Materialize";
import { LiveLights } from "../../scene/LiveLights";
import { ENV_INTENSITY } from "../../scene/materials";
import { Pendants } from "../../scene/Pendants";
import { addEnvironment } from "../../scene/power";
import { Ribbon } from "../../scene/Ribbon";
import { RobotWall } from "../../scene/RobotWall";
import { N_ITEMS, instanceSlot, spiral } from "../../scene/spiral";
import { bench } from "../workbench/draft";
import { benchMatrix } from "../workbench/layout";
import { hiddenInstance, press, wasDrag, type PointerKind } from "./drag";
import { Dragged } from "./Dragged";
import { HubTags } from "./HubTags";
import { usePick } from "./send";
import { shelf } from "./stepper";

/** A small prefiltered room for the glossy plastic to reflect (high and ultra). */
function Reflections() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    const off = addEnvironment(scene, ENV_INTENSITY);
    return () => {
      off();
      scene.environment = null;
      scene.environmentIntensity = 1;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

/**
 * Drives the materialize (one shared uniform) from the workshop's travel. With reduced motion there is
 * no edge to watch: the room is simply there once the journey has left the story (the veil fades it).
 */
function Reveal({ reduced }: { reduced: boolean }) {
  const { store } = useWorld();
  useFrame(() => {
    const f = store.frames;
    dissolve.reveal.value = reduced
      ? store.getCoarse().current === "intro"
        ? -1
        : FIELD_MAX + 1
      : f.workbench.current
        ? FIELD_MAX + 1
        : revealAt(f.workshop.arrive);
  }, -0.5);
  return null;
}

/** Keeps spiral.step on the shelf's step while it is open (the front cartridge stands out). */
function StepFollower() {
  useFrame(() => {
    spiral.step = shelf.open ? Math.min(N_ITEMS - 1, Math.max(0, shelf.step)) : -1;
  });
  return null;
}

export function WorkshopScene({ quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const pick = usePick();
  // The walls are seen at grazing angles: more anisotropy keeps their block lines from shimmering.
  const anisotropy = quality.name === "low" ? 2 : 8;
  // Cartridges answer the pointer only while the workshop (or the machine beside it) is in view,
  // and not while one is open. Not while the room is still materializing either.
  const active = useCallback(
    () => store.frames.workshop.current && store.frames.workshop.arrive >= LAMPS_AT && store.getCoarse().branch === null && spiral.selected < 0,
    [store],
  );
  const browsing = useCallback(() => shelf.open, []);
  // A press on a cartridge: drag.ts makes it a click or a drag to the machine.
  const grab = useCallback((k: number, e: ThreeEvent<PointerEvent>) => {
    const n = e.nativeEvent;
    const kind: PointerKind = n.pointerType === "touch" || n.pointerType === "pen" ? n.pointerType : "mouse";
    if (n.button > 0) return;
    press(k, instanceSlot(k), n.clientX, n.clientY, n.pointerId, kind);
  }, []);
  const benchCart = useMemo<BenchInstance>(
    () => ({
      matrix: benchMatrix(),
      shown: () => store.getCoarse().branch !== "workbench",
      shell: () => bench.draft.color,
      landing: () => bench.landing,
    }),
    [store],
  );
  return (
    <group>
      <Lamps reduced={reduced} />
      <LiveLights />
      {quality.envMap ? <Reflections /> : null}
      <Reveal reduced={reduced} />
      {/* The room, built out of the generator's particles: hidden until it starts to materialize. */}
      <Materialize>
        {BAKED.map((name) => (
          <Suspense key={name} fallback={null}>
            <Baked name={name} anisotropy={anisotropy} cut={name === "machine_body" ? cutBakedBody : undefined} detail={quality.name !== "low"} />
          </Suspense>
        ))}
        <Pendants />
        {quality.haze ? <Haze /> : null}
        <Arm quality={quality} reduced={reduced} />
        <RobotWall quality={quality} reduced={reduced} />
        <Ribbon />
        <HubTags />
        <Suspense fallback={null}>
          <Helix quality={quality} reduced={reduced} active={active} browsing={browsing} onPick={(k) => pick(k)} onGrab={grab} held={hiddenInstance} wasDrag={wasDrag} bench={benchCart} />
        </Suspense>
      </Materialize>
      <Suspense fallback={null}>
        <Dragged quality={quality} reduced={reduced} />
      </Suspense>
      <StepFollower />
    </group>
  );
}
