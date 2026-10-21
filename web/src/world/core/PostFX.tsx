// Post on high and ultra (quality.post): the scene into a half-float target with 4x MSAA, bloom at half
// resolution, then one final pass: an RGB split that grows with the scroll's speed, film grain and a
// vignette, then the sRGB encode. It takes over the canvas's render (useFrame priority 1).
//
// Tone mapping: three only tone-maps when it renders to the screen, and OutputPass would then tone-map
// the whole frame, the baked room too (whose atlas is already the final picture, toneMapped: false).
// So the scene target is flagged as an XR target: three then tone-maps per material into it, exactly
// as on screen, and leaves it linear; the final pass only encodes. Low renders straight to the screen.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { setCompileTarget } from "../../three/compileSafe";
import type { QualityTier } from "./quality";
import type { WorldStore } from "./store";

export const FinalShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uShift: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  // The prototype's final pass (site-journey.html), plus the sRGB encode OutputPass would have done.
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float uShift, uTime; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5; float d = length(c);
      vec2 o = c * uShift * .028;
      vec3 col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      col *= mix(1., smoothstep(.95, .2, d), .45);
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
      gl_FragColor.rgb += (h(vUv * uRes + fract(uTime) * 91.) - .5) * .018;
    }`,
};

/** The RGB split for a scroll speed in viewport heights per second. */
export const splitFor = (vhPerS: number, reduced: boolean) => (reduced ? 0 : Math.min(0.8, Math.abs(vhPerS) * 0.3));

export function PostFX({ store, quality, reduced }: { store: WorldStore; quality: QualityTier; reduced: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const fx = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaa, colorSpace: THREE.LinearSRGBColorSpace });
    const composer = new EffectComposer(gl, target);
    // Tone-mapped per material into linear targets (see the header). The composer renders the scene
    // into its clone of the target, so flag both.
    for (const t of [composer.renderTarget1, composer.renderTarget2]) {
      (t as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
      t.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    composer.addPass(new RenderPass(scene, camera));
    // Warm-ups compile the programs this target needs, not the screen's (compileSafe.ts).
    setCompileTarget(composer.renderTarget1);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.8);
    // Glows that skip tone mapping (the hologram, the strips) add up past 1 where they overlap; the
    // screen would clip them, so the bloom sees them clipped too instead of blowing them out.
    const hp = bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace("vec4 texel = texture2D( tDiffuse, vUv );", "vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 1.0 ) );");
    hp.needsUpdate = true;
    composer.addPass(bloom);
    const final = new ShaderPass(FinalShader);
    composer.addPass(final);
    return { composer, bloom, final };
  }, [gl, scene, camera, quality.msaa]);

  useEffect(() => {
    fx.composer.setPixelRatio(dpr);
    fx.composer.setSize(size.width, size.height);
    // Bloom at half resolution.
    fx.bloom.resolution.set(size.width / 2, size.height / 2);
    fx.final.uniforms.uRes.value.set(size.width, size.height);
  }, [fx, size, dpr]);

  useEffect(
    () => () => {
      setCompileTarget(null);
      fx.composer.renderTarget1.dispose();
      fx.composer.renderTarget2.dispose();
      fx.composer.dispose();
      fx.bloom.dispose();
    },
    [fx],
  );

  const st = useMemo(() => ({ y: store.shownY }), [store]);
  useFrame(({ clock }, delta) => {
    const dt = Math.max(delta, 1e-3);
    const v = (store.shownY - st.y) / dt / Math.max(1, window.innerHeight);
    st.y = store.shownY;
    fx.final.uniforms.uShift.value = splitFor(v, reduced);
    fx.final.uniforms.uTime.value = clock.elapsedTime;
    fx.composer.render(delta);
  }, 1);
  return null;
}
