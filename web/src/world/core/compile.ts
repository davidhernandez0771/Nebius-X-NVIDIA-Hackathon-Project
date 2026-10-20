// Compiling the scene's shaders without blocking the page, as three's renderer.compileAsync does, but
// safe against a material disposed while it waits: compileAsync (r169) then reads `isReady` of an
// undefined program inside its own timer, throws, and never settles, which left the loader waiting
// forever on the odd load. Here a program that's gone counts as done, and a time limit ends the wait.
import type { Camera, Material, Object3D } from "three";

/** The parts of the WebGLRenderer this uses (a fake in the tests). */
export interface Compiler {
  compile(scene: Object3D, camera: Camera): Set<Material> | Set<object>;
  properties: { get(m: object): { currentProgram?: { isReady(): boolean } } };
  extensions: { get(name: string): unknown };
}

export function compileSafe(gl: Compiler, scene: Object3D, camera: Camera, limitMs = 8000): Promise<void> {
  const pending = new Set<object>(gl.compile(scene, camera));
  // Without KHR_parallel_shader_compile, compile() already finished the work.
  const parallel = !!gl.extensions.get("KHR_parallel_shader_compile");
  const t0 = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      pending.forEach((m) => {
        const p = gl.properties.get(m).currentProgram;
        if (!p || p.isReady()) pending.delete(m);
      });
      if (pending.size === 0 || Date.now() - t0 > limitMs) resolve();
      else setTimeout(check, 10);
    };
    if (parallel) check();
    else setTimeout(resolve, 0);
  });
}
