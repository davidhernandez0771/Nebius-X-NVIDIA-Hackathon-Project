// The imperative three.js side of the overlay: one full-screen pass per frame with the
// showing style's program (two, added together, during a crossfade), plus a low-res feedback
// pass for the recording trail while that style shows. The programs compile off the main
// thread (KHR_parallel_shader_compile via compileAsync); nothing draws until they are ready.
// HandArtOverlay owns the animation loop and feeds this one frame at a time.

import {
  AddEquation,
  CustomBlending,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Texture,
} from "three";
import type { HandLandmark } from "../../hand/contracts";
import { initialDirector, stepDirector, type DirectorState } from "./artDirector";
import { GpuTimer } from "./gpuTimer";
import { DEFAULT_CAPS, fieldSize, renderSize, type RenderCaps } from "./quality";
import { QUAD_VERT, TRAIL_FRAG, handFragment } from "./shaders";
import { packSkeleton, type PackedSkeleton } from "./skeleton";
import {
  DEFAULT_CYCLE,
  HAND_ART_STYLES,
  initialCycle,
  stepCycle,
  styleId,
  type CycleOptions,
  type CycleState,
  type HandArtStyle,
} from "./styleCycle";

/** Volt colors, as sRGB components (passed to the shader unconverted). */
export const VOLT = { ink: "#E6EDF3", teal: "#19F5C2", amber: "#FFB000", shade: "#07090C" } as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const TRAIL_FIELD = { scale: 0.5, maxWidth: 400 };
const TRAIL_DECAY_MS = 260;
const GRIP_EASE_MS = 140;
const PRESENCE_EASE_MS = 220;
/** With no hand, the art stays at the last pose (the ripple shows where it was), a little dimmer. */
const LOST_PRESENCE = 0.8;
/** A pinned event style replays on this period (ms), so the preview can show it. */
const REPLAY_MS: Partial<Record<HandArtStyle, number>> = { bloom: 2600, burst: 1500, glitch: 1300 };

export interface RendererOptions {
  mirrored: boolean;
  caps?: RenderCaps;
}

/** One frame's hand and Record state. */
export interface HandArtInput {
  landmarks: readonly HandLandmark[] | null;
  gripperClosed: boolean;
  /** Undefined when the page doesn't say; see ArtSignals. */
  recording?: boolean;
  resets?: number;
  /** Optional: the page's hand control froze the arm; null when unknown. */
  frozen?: boolean | null;
  /** The page's event counter, used only when it sends neither recording nor resets. */
  cue?: number;
}

export interface FrameInfo {
  cycle: CycleState;
  /** The style the Record state calls for (the director's pick). */
  target: HandArtStyle;
  width: number;
  height: number;
  /** CPU time to step and submit the passes. */
  cpuMs: number;
  /** GPU ms of earlier frames whose timings arrived this frame; empty without timer queries. */
  gpuMs: number[];
  drew: boolean;
}

const approach = (v: number, target: number, dtMs: number, tauMs: number) =>
  v + (target - v) * (1 - Math.exp(-dtMs / tauMs));

const quadMaterial = (fragmentShader: string, uniforms: ShaderMaterial["uniforms"]) =>
  new ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    uniforms,
  });

export class HandArtRenderer {
  private readonly gl: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  /** One program per style, in HAND_ART_STYLES order, sharing one uniforms object. */
  private readonly styleMats: ShaderMaterial[];
  private readonly handUniforms: ShaderMaterial["uniforms"];
  private ready = false;
  private compiling: Promise<unknown> | null = null;
  private readonly trailMat: ShaderMaterial;
  private trailRead: WebGLRenderTarget;
  private trailWrite: WebGLRenderTarget;
  private trailLive = false;
  private readonly caps: RenderCaps;
  private readonly timer: GpuTimer | null;
  private mirrored: boolean;

  private cycleOpts: CycleOptions = DEFAULT_CYCLE;
  private cycle: CycleState = initialCycle(DEFAULT_CYCLE, "ink");
  private director: DirectorState = initialDirector();
  private input: HandArtInput = { landmarks: null, gripperClosed: false };
  private lastPacked: PackedSkeleton | null = null;
  private burstSeed = -1;
  private replayIndex = -1;
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
    const rt = () => new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.trailRead = rt();
    this.trailWrite = rt();

    const skeleton = () => ({
      uBones: { value: new Float32Array(84) },
      uAspect: { value: 1 },
      uBoneR: { value: 0.01 },
      uTime: { value: 0 },
    });
    const rgb = (hex: string) => ({ value: new Vector3(...hexToRgb(hex)) });
    this.handUniforms = {
      ...skeleton(),
      uRes: { value: new Vector2(1, 1) },
      uPx: { value: 1 },
      uScale: { value: 0.1 },
      uPalm: { value: new Vector2() },
      uBurst: { value: new Float32Array(20) },
      uBounds: { value: new Vector3() },
      uMix: { value: 0 },
      uPassB: { value: 0 },
      uSeed: { value: 0 },
      uAge: { value: 0 },
      uGrip: { value: 0 },
      uPresence: { value: 0 },
      uTrail: { value: this.trailRead.texture },
      uInk: rgb(VOLT.ink),
      uTeal: rgb(VOLT.teal),
      uAmber: rgb(VOLT.amber),
      uShade: rgb(VOLT.shade),
    };
    this.styleMats = HAND_ART_STYLES.map((_, i) => quadMaterial(handFragment(i), this.handUniforms));
    this.trailMat = quadMaterial(TRAIL_FRAG, {
      ...skeleton(),
      uPrev: { value: null as Texture | null },
      uFieldRes: { value: new Vector2(1, 1) },
      uDecay: { value: 0.9 },
      uDrift: { value: new Vector2() },
      uEmit: { value: 1 },
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.styleMats[0]);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.gl.autoClear = false; // a crossfade adds its second pass onto the first
    const ctx = this.gl.getContext();
    this.timer = "createQuery" in ctx ? GpuTimer.create(ctx) : null;
    this.compile();
  }

  /** Compiles every program without blocking the page (a blocking compile froze it ~1 s). */
  private compile() {
    const all = new Scene();
    for (const m of [...this.styleMats, this.trailMat]) {
      const mesh = new Mesh(this.quad.geometry, m);
      mesh.frustumCulled = false;
      all.add(mesh);
    }
    const done = () => (this.ready = true);
    try {
      this.compiling = this.gl.compileAsync(all, this.camera).then(done, done);
    } catch {
      done(); // no async compile: the first frame compiles them
    }
  }

  setHand(input: HandArtInput) {
    this.input = input;
  }

  setMirrored(mirrored: boolean) {
    this.mirrored = mirrored;
  }

  setCycleOptions(o: CycleOptions) {
    const switchedMode = o.reducedMotion !== this.cycleOpts.reducedMotion;
    this.cycleOpts = o;
    if (switchedMode) this.cycle = initialCycle(o, this.cycle.a);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.size = renderSize(cssW, cssH, dpr, this.caps);
    this.gl.setPixelRatio(1);
    this.gl.setSize(this.size.width, this.size.height, false);
    const f = fieldSize(this.size.width, this.size.height, TRAIL_FIELD);
    this.trailRead.setSize(f.width, f.height);
    this.trailWrite.setSize(f.width, f.height);
    (this.trailMat.uniforms.uFieldRes.value as Vector2).set(f.width, f.height);
    this.trailLive = false;
    const u = this.handUniforms;
    (u.uRes.value as Vector2).set(this.size.width, this.size.height);
    u.uPx.value = this.size.pixelRatio;
    this.cleared = false;
  }

  frame(dtMs: number): FrameInfo {
    const start = performance.now();
    const o = this.cycleOpts;
    const x = this.input;
    const aspect = this.cssW / this.cssH;
    const packed = packSkeleton(x.landmarks, { aspect, mirrored: this.mirrored });
    if (packed) this.lastPacked = packed;

    const d = stepDirector(this.director, dtMs, { ...x, hand: !!packed });
    this.director = d.state;
    this.cycle = stepCycle(this.cycle, dtMs, d.style, o);
    if (!o.reducedMotion) this.time += dtMs / 1000;
    this.grip = o.reducedMotion ? +x.gripperClosed : approach(this.grip, +x.gripperClosed, dtMs, GRIP_EASE_MS);
    const presence = packed ? 1 : this.lastPacked ? LOST_PRESENCE : 0;
    this.presence = o.reducedMotion ? presence : approach(this.presence, presence, dtMs, PRESENCE_EASE_MS);

    const gpuMs = this.timer?.poll() ?? [];
    const info = { cycle: this.cycle, target: d.style, width: this.size.width, height: this.size.height, drew: false, cpuMs: 0, gpuMs };
    const sk = this.lastPacked;
    if (!this.ready || !sk || (this.presence < 0.01 && !packed)) {
      // Nothing to show: clear once, then stay idle until a hand comes back.
      if (!this.cleared) {
        this.gl.setRenderTarget(null);
        this.gl.clear();
        this.cleared = true;
      }
      return { ...info, cpuMs: performance.now() - start };
    }
    this.cleared = false;

    const { a, b } = this.cycle;
    const ageA = this.replayAge(a, this.cycle.ageA, sk);
    const ageB = this.replayAge(b, this.cycle.ageB, sk);
    const burstStarted = this.cycle.ageB < 50 || this.burstSeed === -1;
    if ((a === "burst" || b === "burst") && this.burstSeed !== this.cycle.seed && burstStarted) {
      this.burstSeed = this.cycle.seed; // the fingertips where the hand let go
      (this.handUniforms.uBurst.value as Float32Array).set(sk.tips);
    }

    this.timer?.begin();
    const trailOn = a === "trail" || b === "trail";
    if (trailOn) this.renderTrail(sk, aspect, dtMs, !!packed);
    else this.trailLive = false;

    const u = this.handUniforms;
    u.uBones.value = sk.bones;
    u.uAspect.value = aspect;
    u.uBoneR.value = sk.boneRadius;
    u.uTime.value = this.time;
    u.uScale.value = sk.scale;
    (u.uPalm.value as Vector2).set(sk.palm[0], sk.palm[1]);
    (u.uBounds.value as Vector3).set(sk.palm[0], sk.palm[1], this.boundsRadius(sk));
    u.uMix.value = this.cycle.morphing ? Math.max(this.cycle.mix, 1e-4) : 0;
    u.uSeed.value = this.cycle.seed;
    u.uGrip.value = this.grip;
    u.uPresence.value = this.presence;
    u.uTrail.value = this.trailRead.texture;
    this.gl.setRenderTarget(null);
    this.drawStyle(a, ageA, false);
    if (this.cycle.morphing) this.drawStyle(b, ageB, true);
    this.timer?.end();
    return { ...info, drew: true, cpuMs: performance.now() - start };
  }

  /** One style's pass. The first overwrites every pixel; a crossfade's second adds onto it. */
  private drawStyle(style: HandArtStyle, ageMs: number, passB: boolean) {
    const m = this.styleMats[styleId(style)];
    m.blending = passB ? CustomBlending : NoBlending;
    m.blendSrc = OneFactor;
    m.blendDst = OneFactor;
    m.blendEquation = AddEquation;
    this.handUniforms.uAge.value = ageMs / 1000;
    this.handUniforms.uPassB.value = passB ? 1 : 0;
    this.quad.material = m;
    this.gl.render(this.scene, this.camera);
  }

  /** A pinned event style (the preview) replays; under Record's director it plays once. */
  private replayAge(style: HandArtStyle, ageMs: number, sk: PackedSkeleton): number {
    const period = REPLAY_MS[style];
    if (!period || !this.cycleOpts.pinned || this.cycleOpts.reducedMotion) return ageMs;
    const index = Math.floor(ageMs / period);
    if (style === "burst" && index !== this.replayIndex) {
      this.replayIndex = index;
      (this.handUniforms.uBurst.value as Float32Array).set(sk.tips);
    }
    return ageMs % period;
  }

  /** Nothing is drawn farther than this from the palm (a cheap early-out per pixel). */
  private boundsRadius(sk: PackedSkeleton): number {
    const { a, b } = this.cycle;
    let r = sk.scale * 2.6;
    if (a === "burst" || b === "burst") {
      const t = this.handUniforms.uBurst.value as Float32Array;
      for (let f = 0; f < 5; f++) r = Math.max(r, Math.hypot(t[f * 4] - sk.palm[0], t[f * 4 + 1] - sk.palm[1]) + sk.scale * 2.7);
    }
    return r;
  }

  private renderTrail(sk: PackedSkeleton, aspect: number, dtMs: number, emit: boolean) {
    if (!this.trailLive) {
      for (const t of [this.trailRead, this.trailWrite]) {
        this.gl.setRenderTarget(t);
        this.gl.clear();
      }
      this.trailLive = true;
    }
    const u = this.trailMat.uniforms;
    u.uBones.value = sk.bones;
    u.uAspect.value = aspect;
    u.uBoneR.value = sk.boneRadius;
    u.uTime.value = this.time;
    u.uPrev.value = this.trailRead.texture;
    u.uDecay.value = Math.exp(-dtMs / TRAIL_DECAY_MS);
    (u.uDrift.value as Vector2).set(0, (0.0012 * dtMs) / 16.7);
    u.uEmit.value = emit ? 1 : 0;
    this.quad.material = this.trailMat;
    this.gl.setRenderTarget(this.trailWrite);
    this.gl.render(this.scene, this.camera); // writes every pixel: no clear needed
    [this.trailRead, this.trailWrite] = [this.trailWrite, this.trailRead];
  }

  /** Frees the GPU. While programs still compile, waits for them: three polls them until then. */
  dispose() {
    if (this.compiling && !this.ready) {
      const pending = this.compiling;
      this.compiling = null;
      pending.then(() => this.dispose());
      return;
    }
    this.timer?.dispose();
    this.quad.geometry.dispose();
    this.styleMats.forEach((m) => m.dispose());
    this.trailMat.dispose();
    this.trailRead.dispose();
    this.trailWrite.dispose();
    this.gl.dispose();
  }
}
