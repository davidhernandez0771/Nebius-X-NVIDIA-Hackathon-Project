// The shelf's post chain, kept lean on GPU memory: the scene renders once into a single half-float target, bloom
// runs on a reduced-resolution copy (its bright-pass also caps HDR, so a grazing glint stays a small orb), and the
// grade (ACES, grayscale, vignette, grain, dim on select) draws straight to the canvas. EffectComposer kept two
// full-size half-float targets and a separate clamp pass, and the canvas had a 4× MSAA buffer it never used.
import { Camera, HalfFloatType, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type WebGLRenderer } from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

const GRADE_FRAG = [
  "uniform sampler2D tDiffuse; uniform float time; uniform float dim; uniform float exposure; varying vec2 vUv;",
  "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
  "vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }",
  "vec3 aces(vec3 c){",
  "  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));",
  "  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));",
  "  return clamp(O * fit(I * (c * exposure / 0.6)), 0.0, 1.0);",
  "}",
  "void main(){",
  "  vec3 c = aces(texture2D(tDiffuse, vUv).rgb);",
  "  float l = dot(c, vec3(.299, .587, .114));",
  "  l = pow(smoothstep(.015, 1.0, l), .92);",
  "  float v = smoothstep(1.15, .35, length(vUv - .5) * 1.3);",
  "  l *= mix(.55, 1.0, v) * dim;",
  "  l += (hash(vUv * 1000.0 + time) - .5) * .035;",
  "  gl_FragColor = vec4(vec3(l), 1.0);",
  "}",
].join("\n");

export type BloomSettings = { strength: number; radius: number; threshold: number; cap: number };

export class ShelfPost {
  readonly target: WebGLRenderTarget;
  readonly bloom: UnrealBloomPass;
  private grade: ShaderMaterial;
  private quad: FullScreenQuad;
  private bloomScale = 0.5;
  private w = 1;
  private h = 1;

  constructor(private gl: WebGLRenderer, b: BloomSettings, exposure: number) {
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), b.strength, b.radius, b.threshold);
    // Cap HDR going into the bloom (the old separate clamp pass, folded into the bright-pass).
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace("vec4 texel = texture2D( tDiffuse, vUv );", `vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( ${b.cap.toFixed(3)} ) );`);
    hp.needsUpdate = true;
    this.grade = new ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture }, time: { value: 0 }, dim: { value: 1 }, exposure: { value: exposure } },
      vertexShader: VERT,
      fragmentShader: GRADE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.grade);
  }

  /** Drawing-buffer size in pixels, and the bloom resolution as a fraction of it (0 turns bloom off). */
  setSize(w: number, h: number, bloomScale: number) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.bloomScale = bloomScale;
    this.target.setSize(this.w, this.h);
    if (bloomScale > 0) this.bloom.setSize(Math.max(2, Math.round(this.w * bloomScale)), Math.max(2, Math.round(this.h * bloomScale)));
  }

  setStrength(strength: number) {
    this.bloom.strength = strength;
  }

  render(scene: Scene, camera: Camera, dt: number, time: number, dim: number) {
    const gl = this.gl;
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(scene, camera);
    if (this.bloomScale > 0) this.bloom.render(gl, null as never, this.target, dt, false);
    this.grade.uniforms.time.value = time;
    this.grade.uniforms.dim.value = dim;
    gl.setRenderTarget(null);
    this.quad.render(gl);
  }

  /** Estimated bytes of GPU memory this chain holds (WebGL has no real query). */
  bytes() {
    let b = this.w * this.h * (8 + 4); // half-float RGBA + depth
    if (this.bloomScale > 0) {
      const rt = (t: { width: number; height: number }) => t.width * t.height * 8;
      b += rt(this.bloom.renderTargetBright);
      for (const t of [...this.bloom.renderTargetsHorizontal, ...this.bloom.renderTargetsVertical]) b += rt(t);
    }
    return b;
  }

  dispose() {
    this.target.dispose();
    this.bloom.dispose();
    this.grade.dispose();
    this.quad.dispose();
  }
}
