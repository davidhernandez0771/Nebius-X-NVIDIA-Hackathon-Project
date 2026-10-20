// The room view's tags as holograms (on high and ultra; holoTags.ts holoMode): over each thing to
// click, a small emitter on the object, a thin cone of light up to a glass panel turned square to the
// camera, the panel translucent teal with scanlines, a faint flicker and a glowing edge, its text
// crisp (a 3× canvas atlas, mipmapped). Hovering or focusing a tag lights its panel and stutters it
// in again ("materialize"); entering the room view materializes them all; a cartridge in the hand
// dims them. All four in one geometry and one material: one draw call, none outside the room view.
//
// The panels are only the picture: the clicks, the focus and the names stay on the HTML buttons
// (HubTags), laid exactly over each panel here every frame the camera moves.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ambient } from "../../core/activity";
import { inHub } from "../../core/CameraRig";
import type { QualityTier } from "../../core/quality";
import { useWorld } from "../../core/WorldContext";
import { hiddenInstance } from "./drag";
import type { HubItem } from "./hubItems";
import { CANVAS, HOLO_TAGS, TITLE_PX, buildHoloGeometry, projectPanel, subscribeHot, tagHot } from "./holoTags";

export interface HoloText {
  id: HubItem;
  n: string;
  title: string;
  line: string;
  /** The first visit's "start here" (the shelf). */
  start: boolean;
}

const INK = "#d8efe9";
const TEAL = "#19f5c2";
const DIM = "#9dbdb5";
const AMBER = "#ffb000";
const FONT = '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace';
/** A materialize stutter lasts this long (s); "never" is a long time ago. */
const NEVER = 1e3;

/** Prints each tag's text into its row of the atlas (row i: tag i, top to bottom), on a clear ground. */
function drawAtlas(canvas: HTMLCanvasElement, texts: readonly HoloText[]): boolean {
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h * texts.length;
  const g = canvas.getContext("2d");
  if (!g) return false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 44;
  const spaced = (px: number) => {
    // letterSpacing is in Chrome and Firefox; elsewhere the text is just tighter.
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
  };
  // Three times: a dark blurred halo (it darkens what is behind the glass, so a lit cartridge there
  // never washes the words out), a soft teal glow, then the text crisp on top.
  const text = (s: string, x: number, y: number, font: string, color: string, space: number) => {
    g.font = font;
    spaced(space);
    g.save();
    g.shadowColor = "rgba(0, 0, 0, 0.95)";
    g.shadowBlur = 18;
    g.fillStyle = "rgba(0, 0, 0, 0.9)";
    for (let k = 0; k < 2; k++) g.fillText(s, x, y);
    g.restore();
    g.save();
    g.shadowColor = "rgba(25, 245, 194, 0.55)";
    g.shadowBlur = 14;
    g.fillStyle = color;
    g.globalAlpha = 0.6;
    g.fillText(s, x, y);
    g.restore();
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  texts.forEach((t, i) => {
    const y0 = i * CANVAS.h;
    g.textBaseline = "alphabetic";
    text(t.n, pad, y0 + pad + 26, `500 30px ${FONT}`, TEAL, 3);
    text(t.title.toUpperCase(), pad, y0 + pad + 26 + 26 + TITLE_PX, `700 ${TITLE_PX}px ${FONT}`, INK, 4);
    // The line, wrapped to the panel.
    g.font = `400 33px ${FONT}`;
    spaced(1);
    const words = t.line.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width > CANVAS.w - 2 * pad && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((l, k) => text(l, pad, y0 + pad + 26 + 26 + TITLE_PX + 58 + k * 44, `400 33px ${FONT}`, DIM, 1));
    if (t.start) text("START HERE", pad, y0 + CANVAS.h - pad + 6, `600 26px ${FONT}`, AMBER, 5);
  });
  return true;
}

const vert = /* glsl */ `
attribute vec2 aLocal;
attribute float aKind;
attribute float aTag;
varying vec2 vUv;
varying vec2 vLocal;
varying float vKind;
varying float vTag;
void main() {
  vUv = uv;
  vLocal = aLocal;
  vKind = aKind;
  vTag = aTag;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

// Premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA): the glass darkens what is behind it a little, and
// the light (the text's glow, the edge, the cones, the emitters) adds, all in one pass.
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uOn;
uniform float uDim;
uniform vec4 uHot;
uniform vec4 uSince;
uniform vec3 uTeal;
uniform vec3 uGlassLo;
uniform vec3 uGlassHi;
varying vec2 vUv;
varying vec2 vLocal;
varying float vKind;
varying float vTag;

float pick(vec4 v) { return dot(v, vec4(equal(vec4(floor(vTag + 0.5)), vec4(0.0, 1.0, 2.0, 3.0)))); }
float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float hot = pick(uHot);
  float since = pick(uSince);
  // Materialize: a stutter of on and off for a third of a second, coming up.
  float mat = since < 0.34 ? step(0.32, hash(floor(uTime * 36.0) + vTag * 7.0)) * (0.45 + since * 1.6) : 1.0;
  float flicker = 0.95 + 0.05 * sin(uTime * 29.0 + vTag * 2.1) * sin(uTime * 6.7 + vTag);
  float level = uOn * mix(1.0, 0.1, uDim) * mat * flicker;
  if (vKind < 0.5) {
    vec4 tex = texture2D(uMap, vUv);
    vec2 p = vLocal;
    float e = min(min(p.x, 1.0 - p.x) * ${(240 / 136).toFixed(4)}, min(p.y, 1.0 - p.y));
    float rim = smoothstep(0.014, 0.0, e) + 0.3 * smoothstep(0.09, 0.0, e);
    float scan = step(0.5, fract(p.y * 64.0));
    float band = smoothstep(0.06, 0.0, abs(fract(p.y + uTime * 0.16) - 0.5) - 0.44);
    // Smoked glass: dark enough that a lit cartridge behind it (brighter than white in the HDR scene
    // target) never washes the text out; the scanlines are faint light on it, not holes in it.
    float glassA = 0.8 + 0.08 * hot;
    vec3 glass = mix(uGlassLo, uGlassHi, p.y);
    vec3 col = glass * glassA * (1.0 - tex.a) + tex.rgb * (1.0 + 0.3 * hot);
    col += uTeal * (rim * (0.5 + 0.8 * hot) + band * (0.05 + 0.05 * hot) + scan * 0.018 * (1.0 - tex.a));
    float a = glassA * (1.0 - tex.a) + tex.a;
    gl_FragColor = vec4(col, a) * level;
  } else if (vKind < 1.5) {
    float y = clamp(vLocal.y, 0.0, 1.0);
    float across = abs(vLocal.x / max(vLocal.y, 1e-3));
    float soft = smoothstep(1.0, 0.4, across);
    float streak = 0.7 + 0.3 * sin(y * 34.0 - uTime * 4.0);
    float a = soft * streak * (0.09 + 0.08 * hot) * (1.4 - 0.8 * y);
    gl_FragColor = vec4(uTeal * a * level, 0.0);
  } else {
    float r = length(vLocal);
    float disc = smoothstep(1.0, 0.0, r);
    float ring = smoothstep(0.09, 0.0, abs(r - 0.68 - 0.05 * sin(uTime * 2.6 + vTag)));
    float a = (disc * disc * 0.5 + ring * 0.55) * (0.8 + 0.5 * hot);
    gl_FragColor = vec4(uTeal * a * level, 0.0);
  }
  #include <colorspace_fragment>
}`;

const HUB_TAGS = HOLO_TAGS.length;

export function HubHolograms({ texts, wraps, quality }: { texts: readonly HoloText[]; wraps: { current: HTMLDivElement[] }; quality: QualityTier }) {
  const { store } = useWorld();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const geometry = useMemo(() => buildHoloGeometry(HOLO_TAGS), []);
  const texKey = texts.map((t) => `${t.n}|${t.title}|${t.line}|${t.start}`).join("/");
  const map = useMemo(() => {
    const canvas = document.createElement("canvas");
    drawAtlas(canvas, texts);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.premultiplyAlpha = true;
    t.anisotropy = 4;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
    // The text only changes with the tags' words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texKey]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uMap: { value: map },
          uTime: { value: 0 },
          uOn: { value: 0 },
          uDim: { value: 0 },
          uHot: { value: new THREE.Vector4() },
          uSince: { value: new THREE.Vector4(NEVER, NEVER, NEVER, NEVER) },
          uTeal: { value: new THREE.Color(TEAL) },
          uGlassLo: { value: new THREE.Color("#020f0e") },
          uGlassHi: { value: new THREE.Color("#062a25") },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [map],
  );
  const mesh = useRef<THREE.Mesh>(null);
  const st = useRef({ on: 0, shown: false, dim: 0, hot: [0, 0, 0, 0], start: [-NEVER, -NEVER, -NEVER, -NEVER], hotWas: [false, false, false, false] });

  // The real fonts arriving reprint the atlas.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let live = true;
    Promise.all([fonts.load(`700 ${TITLE_PX}px "Geist Mono"`), fonts.load('400 33px "Geist Mono"')])
      .then(() => {
        if (!live) return;
        drawAtlas(map.image as HTMLCanvasElement, texts);
        map.needsUpdate = true;
        invalidate();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [map, texts, invalidate]);
  useEffect(() => subscribeHot(() => invalidate()), [invalidate]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => (material.dispose(), map.dispose()), [material, map]);

  useFrame((state, delta) => {
    const s = st.current;
    const m = mesh.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const u = material.uniforms;
    const on = inHub(store);
    // Entering the room view: they all materialize.
    if (on && !s.shown) for (let i = 0; i < HUB_TAGS; i++) s.start[i] = now + i * 0.07;
    s.shown = on;
    const k = 1 - Math.exp(-dt * 6);
    s.on += ((on ? 1 : 0) - s.on) * k;
    if (!on && s.on < 0.01) s.on = 0;
    s.dim += ((hiddenInstance() >= 0 ? 1 : 0) - s.dim) * (1 - Math.exp(-dt * 10));
    let busy = Math.abs((on ? 1 : 0) - s.on) > 0.01;
    HOLO_TAGS.forEach((t, i) => {
      const h = tagHot(t.id);
      if (h && !s.hotWas[i]) s.start[i] = now;
      s.hotWas[i] = h;
      s.hot[i] += ((h ? 1 : 0) - s.hot[i]) * (1 - Math.exp(-dt * 12));
      busy ||= Math.abs((h ? 1 : 0) - s.hot[i]) > 0.01 || now - s.start[i] < 0.4;
    });
    u.uTime.value = now;
    u.uOn.value = s.on;
    u.uDim.value = s.dim;
    u.uHot.value.set(s.hot[0], s.hot[1], s.hot[2], s.hot[3]);
    u.uSince.value.set(now - s.start[0], now - s.start[1], now - s.start[2], now - s.start[3]);
    m.visible = s.on > 0;

    // The HTML buttons over the panels: the same box on screen. drei mounts them a little after the
    // first frame, so each is checked against the size it was last given.
    if (on) {
      HOLO_TAGS.forEach((t, i) => {
        const el = wraps.current[i];
        if (!el) return;
        const r = projectPanel(t, camera, size.width, size.height);
        const w = `${Math.round(r.x1 - r.x0)}px`;
        const h = `${Math.round(r.y1 - r.y0)}px`;
        if (el.style.width !== w) el.style.width = w;
        if (el.style.height !== h) el.style.height = h;
      });
    }
    // A slow flicker on the tiers that idle-animate (holograms are never on low); else only while something moves.
    if (s.on > 0 && quality.idleMotion) ambient(invalidate);
    else if (busy) invalidate();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={12} visible={false} raycast={() => null} name="hub:holograms" />;
}

