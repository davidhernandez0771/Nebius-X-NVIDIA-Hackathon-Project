// The quick GPU check on load. It asks for a WebGL2 context (three.js needs it), reads which GPU
// answers, and times one small fixed fragment workload. Then it is released. classifyGpu() turns that
// into a tier, or "stills" when there is no usable GPU (no WebGL2, a software renderer, or the
// browser's own performance caveat). The probe takes ~10–30 ms once per session (cached).

export type GpuClass = "stills" | "low" | "high" | "ultra";

export interface GpuReport {
  webgl2: boolean;
  /** The unmasked renderer string when the browser gives it, else the masked one. */
  renderer: string;
  /** The context only came up without failIfMajorPerformanceCaveat (e.g. software fallback). */
  caveat: boolean;
  /** Milliseconds for the timed workload (BENCH below), or null when it couldn't run. */
  ms: number | null;
}

/** The timed workload: DRAWS full passes of a 48-step loop over a SIZE x SIZE target. */
export const BENCH = { size: 512, draws: 8, steps: 48 } as const;

/**
 * Thresholds on BENCH, in ms. Measured in Chrome: an RTX 5080 takes 0.2–0.9 ms (5 runs, at the
 * 0.1 ms timer resolution). A mid laptop GPU (Iris Xe, Radeon 680M) has roughly 1/20 of its shader
 * throughput, so ~5–20 ms; an old integrated one ~50 ms. Above STILLS_MS the canvas would not hold
 * even 20 fps. Not yet checked on a laptop: docs/superpowers/notes/2026-10-18-world-workshop.md.
 */
export const BENCH_MS = { ultra: 3, high: 24, stills: 400 } as const;

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
/** Discrete or high-end GPUs. */
const STRONG = /\b(rtx|geforce (gtx )?(9[6-9]0|1[0-9]{3}|16[0-9]{2})|radeon (rx|pro)|arc a[3-9]|apple m[1-9] (pro|max|ultra))/i;
/** Old integrated and phone GPUs. */
const WEAK = /intel.*\b(u?hd) graphics|mali-|adreno \(?tm\)? [1-5]\d\d|powervr|geforce mx|geforce [1-9]\d\d[a-z]?\b/i;

export function classifyGpu(r: GpuReport): GpuClass {
  if (!r.webgl2 || r.caveat || SOFTWARE.test(r.renderer)) return "stills";
  let c: GpuClass = STRONG.test(r.renderer) ? "ultra" : WEAK.test(r.renderer) ? "low" : "high";
  if (r.ms === null) return c === "ultra" ? "high" : c;
  // The timing only ever lowers the class the name suggests (a fast unknown GPU stays high).
  if (r.ms > BENCH_MS.stills) return "stills";
  if (r.ms > BENCH_MS.high) c = "low";
  else if (r.ms > BENCH_MS.ultra && c === "ultra") c = "high";
  return c;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 0.01 + uSeed;
  float a = 0.0;
  for (int i = 0; i < ${BENCH.steps}; i++) {
    p = vec2(sin(p.x * 1.7 + a), cos(p.y * 1.3 - a));
    a += dot(p, p) * 0.11;
  }
  o = vec4(fract(a), p * 0.5 + 0.5, 1.0);
}`;

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

function context(caveatOk: boolean): WebGL2RenderingContext | null {
  try {
    const c = document.createElement("canvas");
    c.width = BENCH.size;
    c.height = BENCH.size;
    return c.getContext("webgl2", { failIfMajorPerformanceCaveat: !caveatOk, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
}

export function probeGpu(now: () => number = () => performance.now()): GpuReport {
  let caveat = false;
  let gl = context(false);
  if (!gl) {
    gl = context(true);
    caveat = gl !== null;
  }
  if (!gl) return { webgl2: false, renderer: "", caveat: false, ms: null };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  let ms: number | null = null;
  try {
    const prog = caveat || SOFTWARE.test(renderer) ? null : program(gl);
    if (prog) {
      gl.useProgram(prog);
      const seed = gl.getUniformLocation(prog, "uSeed");
      gl.viewport(0, 0, BENCH.size, BENCH.size);
      const px = new Uint8Array(4);
      const draw = (i: number) => {
        gl!.uniform1f(seed, i * 0.37);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      };
      // Warm up (compile, first upload), wait for it, then time the passes and wait again.
      draw(0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = now();
      for (let i = 1; i <= BENCH.draws; i++) draw(i);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms = now() - t0;
    }
  } catch {
    ms = null;
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { webgl2: true, renderer, caveat, ms };
}

const KEY = "world.gpu";

/** The check, once per session: Back from a 2D page doesn't run it again. */
export function checkGpu(storage: Storage | undefined, probe: () => GpuReport = probeGpu): { gpu: GpuClass; report: GpuReport | null } {
  try {
    const hit = storage?.getItem(KEY);
    if (hit) {
      const saved = JSON.parse(hit) as { gpu: GpuClass; report: GpuReport };
      if (saved && typeof saved.gpu === "string") return saved;
    }
  } catch {
    /* unreadable: probe again */
  }
  const report = probe();
  const gpu = classifyGpu(report);
  try {
    storage?.setItem(KEY, JSON.stringify({ gpu, report }));
  } catch {
    /* storage full or blocked */
  }
  return { gpu, report };
}
