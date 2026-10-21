// renderer.compileAsync() without its crash. three r169 compiles the scene, then polls each
// material's program until the driver says it's linked. A material disposed (or swapped out) while
// that poll waits has no program any more, so the poll throws "Cannot read properties of undefined
// (reading 'isReady')" inside a timer: an uncaught error, and a promise that never settles. This polls
// the same way, drops a material that lost its program (nothing left to wait for), and gives up after
// `capMs` (a lost context never reports a program ready). `onProgress` hears how many programs are linked
// of how many, as they link (the loader's shader count).
//
// Programs depend on the render target they draw into (its colour space): with the post chain on, every frame
// draws into the composer's linear target, so a compile for the screen made programs no frame used, and each
// object compiled again on its first frame. PostFX registers its target (setCompileTarget) and compiles go there.
import type { Camera, Material, Object3D, WebGLRenderer, WebGLRenderTarget } from "three";

type Program = { isReady(): boolean | null };
type Renderer = Pick<WebGLRenderer, "compile"> & Partial<Pick<WebGLRenderer, "getRenderTarget" | "setRenderTarget">> & {
  properties: { get(m: Material): unknown };
  extensions: { has(name: string): boolean };
};

const POLL_MS = 10;

let compileTarget: WebGLRenderTarget | null = null;

/** The render target frames draw into (the post chain's), or null for the screen. */
export function setCompileTarget(t: WebGLRenderTarget | null): void {
  compileTarget = t;
}

export function compileSafe(gl: Renderer, scene: Object3D, camera: Camera, capMs = 10000, onProgress?: (linked: number, total: number) => void): Promise<void> {
  let materials: Set<Material>;
  const swap = compileTarget && gl.getRenderTarget && gl.setRenderTarget;
  const prev = swap ? gl.getRenderTarget!() : null;
  try {
    if (swap) gl.setRenderTarget!(compileTarget);
    materials = gl.compile(scene, camera) as Set<Material>;
  } catch (e) {
    return Promise.reject(e);
  } finally {
    if (swap) gl.setRenderTarget!(prev);
  }
  // The cap counts the poll's own waits, not the clock.
  let waited = 0;
  const total = materials.size;
  let told = -1;
  const tell = () => {
    const linked = total - materials.size;
    if (linked === told) return;
    told = linked;
    onProgress?.(linked, total);
  };
  tell();
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
      tell();
      if (materials.size === 0 || waited >= capMs) resolve();
      else wait();
    };
    // As three does: with parallel compile the status can be read at once; without it, give the
    // driver a moment first.
    if (gl.extensions.has("KHR_parallel_shader_compile")) check();
    else wait();
  });
}
