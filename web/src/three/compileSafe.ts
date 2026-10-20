// renderer.compileAsync() without its crash. three r169 compiles the scene, then polls each
// material's program until the driver says it's linked. A material disposed (or swapped out) while
// that poll waits has no program any more, so the poll throws "Cannot read properties of undefined
// (reading 'isReady')" inside a timer: an uncaught error, and a promise that never settles. This polls
// the same way, drops a material that lost its program (nothing left to wait for), and gives up after
// `capMs` (a lost context never reports a program ready).
import type { Camera, Material, Object3D, WebGLRenderer } from "three";

type Program = { isReady(): boolean | null };
type Renderer = Pick<WebGLRenderer, "compile"> & {
  properties: { get(m: Material): unknown };
  extensions: { has(name: string): boolean };
};

const POLL_MS = 10;

export function compileSafe(gl: Renderer, scene: Object3D, camera: Camera, capMs = 10000): Promise<void> {
  let materials: Set<Material>;
  try {
    materials = gl.compile(scene, camera) as Set<Material>;
  } catch (e) {
    return Promise.reject(e);
  }
  // The cap counts the poll's own waits, not the clock.
  let waited = 0;
  return new Promise((resolve) => {
    const wait = () => {
      waited += POLL_MS;
      setTimeout(check, POLL_MS);
    };
    const check = () => {
      materials.forEach((m) => {
        const program = (gl.properties.get(m) as { currentProgram?: Program }).currentProgram;
        if (!program || program.isReady()) materials.delete(m);
      });
      if (materials.size === 0 || waited >= capMs) resolve();
      else wait();
    };
    // As three does: with parallel compile the status can be read at once; without it, give the
    // driver a moment first.
    if (gl.extensions.has("KHR_parallel_shader_compile")) check();
    else wait();
  });
}
