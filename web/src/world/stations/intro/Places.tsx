// The places under the hero: the forest and the reactor (Forest.tsx, Reactor.tsx), driven by the
// intro's scroll (storyPlan.ts) and, for the reactor's last moments, the descent's: THE RING bursts and
// the rest goes dark as the generator's particles fill the shaft. Loaded after the loader (Scene.tsx),
// so the first frame doesn't wait for it; its shaders are compiled as soon as it mounts, long before
// the camera gets there, so the first drop doesn't hitch. Nothing here with reduced motion: the camera
// holds the hero then (index.tsx rest).
import { useEffect } from "react";
import { markStanding } from "../../core/standing";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { compileSafe } from "../../../three/compileSafe";
import { ambient } from "../../core/activity";
import type { QualityTier } from "../../core/quality";
import { useWorld } from "../../core/WorldContext";
import { useForest } from "./Forest";
import { useReactor } from "./Reactor";
import { dropLight, INTRO_VH, placeLights, power, progress, ringLift } from "./storyPlan";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Every object under `roots` drawn for one synchronous compile, then put back as it was. */
function warm(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, roots: THREE.Object3D[]): Promise<void> {
  const was: [THREE.Object3D, boolean][] = [];
  for (const r of roots)
    r.traverse((o) => {
      was.push([o, o.visible]);
      o.visible = true;
    });
  // compileSafe calls gl.compile synchronously before it returns its promise.
  const done = compileSafe(gl, scene, camera);
  for (const [o, v] of was) o.visible = v;
  return done;
}

export default function Places({ quality, reduced }: { quality: QualityTier; reduced: boolean }) {
  useEffect(() => markStanding("intro:places"), []);
  const { store } = useWorld();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const forest = useForest(quality);
  const reactor = useReactor(quality);

  useEffect(() => {
    let live = true;
    warm(gl, scene, camera, [forest.group, reactor.group]).then(
      () => live && invalidate(),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gl, scene, camera, invalidate, forest, reactor]);

  useFrame(({ clock }, delta) => {
    const vh = store.frames.intro.t * INTRO_VH;
    const d = store.frames.descent.t;
    const time = clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const pr = gl.getPixelRatio();
    const l = reduced ? { hero: 1, forest: 0, reactor: 0 } : placeLights(vh);
    // The crack's glow comes up as the camera walks toward it.
    const glow = 0.25 + 0.75 * smooth(0.3, 1, progress("forest", vh));
    forest.update({ light: l.forest, drop: reduced ? 0 : dropLight(vh), glow, time, pr, still: reduced });
    reactor.update({
      light: l.reactor * (1 - smooth(0.03, 0.12, d)),
      ringLight: l.reactor,
      power: power(vh),
      lift: ringLift(vh),
      burst: smooth(0.02, 0.2, d),
      time,
      dt,
      pr,
    });
    if ((forest.group.visible || reactor.group.visible) && quality.idleMotion && !reduced) ambient(invalidate);
  });

  return (
    <>
      <primitive object={forest.group} />
      <primitive object={reactor.group} />
    </>
  );
}
