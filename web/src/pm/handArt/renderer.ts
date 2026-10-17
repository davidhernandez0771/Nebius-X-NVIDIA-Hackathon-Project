// The imperative three.js side of the overlay: two full-screen passes on one quad.
// HandArtOverlay owns the animation loop and feeds this one frame at a time.

import {
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import type { HandLandmark } from "../../hand/contracts";
import { GpuTimer } from "./gpuTimer";
import { DEFAULT_CAPS, fieldSize, renderSize, type RenderCaps } from "./quality";
import { FIELD_FRAG, POST_FRAG, QUAD_VERT } from "./shaders";
import { packSkeleton } from "./skeleton";
import { DEFAULT_CYCLE, initialCycle, stepCycle, styleId, type CycleOptions, type CycleState } from "./styleCycle";

/** Volt colors, as sRGB components (passed to the shader unconverted). */
export const VOLT = { teal: "#19F5C2", amber: "#FFB000", violet: "#A78BFA" } as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const FIELD = { scale: 0.5, maxWidth: 480 };
const GRIP_EASE_MS = 140;
const PRESENCE_EASE_MS = 220;

export interface RendererOptions {
  mirrored: boolean;
  caps?: RenderCaps;
}

export interface FrameInfo {
  cycle: CycleState;
  width: number;
  height: number;
  /** CPU time to step and submit both passes. */
  cpuMs: number;
  /** GPU ms of earlier frames whose timings arrived this frame; empty without timer queries. */
  gpuMs: number[];
  drew: boolean;
}

const approach = (v: number, target: number, dtMs: number, tauMs: number) =>
  v + (target - v) * (1 - Math.exp(-dtMs / tauMs));

export class HandArtRenderer {
  private readonly gl: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly target: WebGLRenderTarget;
  private readonly fieldMat: ShaderMaterial;
  private readonly postMat: ShaderMaterial;
  private readonly caps: RenderCaps;
  private readonly timer: GpuTimer | null;
  private mirrored: boolean;

  private cycleOpts: CycleOptions = DEFAULT_CYCLE;
  private cycle: CycleState = initialCycle(DEFAULT_CYCLE);
  private landmarks: readonly HandLandmark[] | null = null;
  private gripperClosed = false;
  private grip = 0;
  private presence = 0;
  private time = 0;
  private cssW = 1;
  private cssH = 1;
  private size = { width: 1, height: 1, pixelRatio: 1 };
  private cleared = false;

  /** Throws if WebGL is unavailable. */
  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.gl = new WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    this.gl.setClearColor(0x000000, 0);
    this.mirrored = opts.mirrored;
    this.caps = opts.caps ?? DEFAULT_CAPS;
    this.target = new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });

    this.fieldMat = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FIELD_FRAG,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uJoints: { value: new Float32Array(84) },
        uBones: { value: new Float32Array(84) },
        uAspect: { value: 1 },
        uBoneR: { value: 0.01 },
      },
    });
    this.postMat = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: POST_FRAG,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: this.target.texture },
        uRes: { value: new Vector2(1, 1) },
        uPx: { value: 1 },
        uTime: { value: 0 },
        uStyleA: { value: 0 },
        uStyleB: { value: 0 },
        uMix: { value: 0 },
        uSeed: { value: 0 },
        uGrip: { value: 0 },
        uPresence: { value: 0 },
        uTeal: { value: new Vector3(...hexToRgb(VOLT.teal)) },
        uAmber: { value: new Vector3(...hexToRgb(VOLT.amber)) },
        uViolet: { value: new Vector3(...hexToRgb(VOLT.violet)) },
      },
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.fieldMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const ctx = this.gl.getContext();
    this.timer = "createQuery" in ctx ? GpuTimer.create(ctx) : null;
  }

  setHand(landmarks: readonly HandLandmark[] | null, gripperClosed: boolean) {
    this.landmarks = landmarks;
    this.gripperClosed = gripperClosed;
  }

  setMirrored(mirrored: boolean) {
    this.mirrored = mirrored;
  }

  setCycleOptions(o: CycleOptions) {
    const switchedMode = o.reducedMotion !== this.cycleOpts.reducedMotion;
    this.cycleOpts = o;
    if (switchedMode) this.cycle = { ...initialCycle(o), lastGrip: this.cycle.lastGrip };
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.size = renderSize(cssW, cssH, dpr, this.caps);
    this.gl.setPixelRatio(1);
    this.gl.setSize(this.size.width, this.size.height, false);
    const f = fieldSize(this.size.width, this.size.height, FIELD);
    this.target.setSize(f.width, f.height);
    const u = this.postMat.uniforms;
    (u.uRes.value as Vector2).set(this.size.width, this.size.height);
    u.uPx.value = this.size.pixelRatio;
    this.cleared = false;
  }

  frame(dtMs: number): FrameInfo {
    const start = performance.now();
    const o = this.cycleOpts;
    this.cycle = stepCycle(this.cycle, dtMs, this.gripperClosed, o);
    if (!o.reducedMotion) this.time += dtMs / 1000;
    this.grip = o.reducedMotion ? +this.gripperClosed : approach(this.grip, +this.gripperClosed, dtMs, GRIP_EASE_MS);

    const packed = packSkeleton(this.landmarks, { aspect: this.cssW / this.cssH, mirrored: this.mirrored });
    this.presence = o.reducedMotion ? +!!packed : approach(this.presence, +!!packed, dtMs, PRESENCE_EASE_MS);

    const gpuMs = this.timer?.poll() ?? [];
    const info = { cycle: this.cycle, width: this.size.width, height: this.size.height, drew: false, cpuMs: 0, gpuMs };
    if (this.presence < 0.01 && !packed) {
      // Nothing to show: clear once, then stay idle until a hand comes back.
      if (!this.cleared) {
        this.gl.setRenderTarget(null);
        this.gl.clear();
        this.cleared = true;
      }
      return { ...info, cpuMs: performance.now() - start };
    }
    this.cleared = false;

    this.timer?.begin();
    if (packed) {
      const fu = this.fieldMat.uniforms;
      fu.uJoints.value = packed.joints;
      fu.uBones.value = packed.bones;
      fu.uAspect.value = this.cssW / this.cssH;
      fu.uBoneR.value = packed.boneRadius;
      this.quad.material = this.fieldMat;
      this.gl.setRenderTarget(this.target);
      this.gl.render(this.scene, this.camera);
    } // else: fade out the last skeleton still in the target

    const u = this.postMat.uniforms;
    u.uTime.value = this.time;
    u.uStyleA.value = styleId(this.cycle.a);
    u.uStyleB.value = styleId(this.cycle.b);
    u.uMix.value = this.cycle.morphing ? Math.max(this.cycle.mix, 1e-4) : 0;
    u.uSeed.value = this.cycle.seed;
    u.uGrip.value = this.grip;
    u.uPresence.value = this.presence;
    this.quad.material = this.postMat;
    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
    this.timer?.end();
    return { ...info, drew: true, cpuMs: performance.now() - start };
  }

  dispose() {
    this.timer?.dispose();
    this.quad.geometry.dispose();
    this.fieldMat.dispose();
    this.postMat.dispose();
    this.target.dispose();
    this.gl.dispose();
  }
}
