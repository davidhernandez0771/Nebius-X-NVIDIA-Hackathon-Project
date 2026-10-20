// What materializes with the room (scene/dissolve.ts): the workshop's meshes and the machine's. Hidden
// while nothing of the room is revealed (the intro, the descent), then every built-in material in it
// dissolves in through the noise edge. Materials are patched as they arrive, and once more just before
// the warm-up compiles what streamed in (core/Perf.tsx beforeWarm), so the patched shaders compile under
// the loader, not on the first frame of the transition.
import { useEffect, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Material, Mesh, Object3D } from "three";
import { beforeWarm } from "../core/Perf";
import { anyRevealed, canDissolve, dissolvable } from "./dissolve";

/** Patches every built-in mesh material under `root` (once each). */
export function patchTree(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (!x.userData.dissolve && canDissolve(x)) dissolvable(x);
  });
}

export function Materialize({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  useEffect(() => {
    const patch = () => ref.current && patchTree(ref.current);
    beforeWarm.add(patch);
    return () => void beforeWarm.delete(patch);
  }, []);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    patchTree(g);
    g.visible = anyRevealed();
  });
  return <group ref={ref}>{children}</group>;
}
