// The room view's tags as holographic labels (on high and ultra; holoTags.ts holoMode), small and
// quiet like Active Theory's in-world labels. At rest each is one line, "01  THE SHELF", in corner
// brackets on see-through teal glass, just beside its object; a slim, faint beam runs up to it from a
// small emitter on the object. Hovering or focusing a label lights it, stutters it in again
// ("materialize") and unfolds it up and to the right to show its line. Entering the room view
// materializes them all; a cartridge in the hand dims them. Text is crisp: a 3× canvas atlas, mipmapped.
// All of them in one geometry and one material: one draw call, none outside the room view.
//
// The labels are only the picture: the clicks, the focus and the names stay on the HTML buttons
// (HubTags), laid exactly over each label here every frame (they grow with it as it unfolds).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ambient } from "../../core/activity";
import { inHub } from "../../core/CameraRig";
import type { QualityTier } from "../../core/quality";
import { useWorld } from "../../core/WorldContext";
import { hiddenInstance } from "./drag";
import type { HubItem } from "./hubItems";
import { CANVAS, HOLO_TAGS, LABEL, SCALE, buildHoloGeometry, projectLabel, subscribeHot, tagHot } from "./holoTags";

export interface HoloText {
  id: HubItem;
  n: string;
  title: string;
  line: string;
  /** The first visit's "start here" (the shelf): an amber number, and the words in its line. */
  start: boolean;
}

const INK = "#d8efe9";
const TEAL = "#19f5c2";
const DIM = "#9dbdb5";
const AMBER = "#ffb000";
const FONT = '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace';
/** A materialize stutter lasts this long (s); "never" is a long time ago. */
const NEVER = 1e3;
const px = (n: number) => n * SCALE;

/** Prints each label's text into its row of the atlas (row i: tag i, top to bottom), on a clear ground. */
function drawAtlas(canvas: HTMLCanvasElement, texts: readonly HoloText[]): boolean {
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h * texts.length;
  const g = canvas.getContext("2d");
  if (!g) return false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const spaced = (n: number) => {
    // letterSpacing is in Chrome and Firefox; elsewhere the text is just tighter.
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${n}px`;
  };
  // A soft teal glow under the text, then the text crisp on top.
  const text = (s: string, x: number, y: number, font: string, color: string, track: number) => {
    g.font = font;
    spaced(track);
    g.save();
    g.shadowColor = "rgba(25, 245, 194, 0.5)";
    g.shadowBlur = 10;
    g.globalAlpha = 0.55;
    g.fillStyle = color;
    g.fillText(s, x, y);
    g.restore();
    g.fillStyle = color;
    g.fillText(s, x, y);
    return g.measureText(s).width;
  };
  texts.forEach((t, i) => {
    const y0 = i * CANVAS.h;
    g.textBaseline = "middle";
    // The title line: the number, then the title, across the rest height.
    const mid = y0 + px(LABEL.restH / 2) + px(1);
    const x0 = px(LABEL.padX);
    text(t.n, x0, mid, `500 ${px(LABEL.numPx)}px ${FONT}`, t.start ? AMBER : TEAL, px(LABEL.numTrack));
    const xt = x0 + t.n.length * px(LABEL.numPx * LABEL.advance + LABEL.numTrack) + px(LABEL.gap);
    text(t.title.toUpperCase(), xt, mid, `700 ${px(LABEL.titlePx)}px ${FONT}`, INK, px(LABEL.titleTrack));
    // Under it, shown when it unfolds: its line, wrapped to two lines at most.
    g.textBaseline = "alphabetic";
    g.font = `400 ${px(LABEL.linePx)}px ${FONT}`;
    spaced(px(0.3));
    const words = (t.start ? `Start here. ${t.line}` : t.line).split(" ");
    const lines: string[] = [];
    let cur = "";
    const room = px(LABEL.openW - 2 * LABEL.padX);
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width > room && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach((l, k) => text(l, x0, y0 + px(LABEL.restH + 12 + k * 16), `400 ${px(LABEL.linePx)}px ${FONT}`, DIM, px(0.3)));
  });
  return true;
}

const vert = /* glsl */ `
attribute vec2 aLocal;
attribute vec2 aRest;
attribute float aKind;
attribute float aTag;
varying vec2 vRow;
varying vec2 vLocal;
varying vec2 vRest;
varying float vKind;
varying float vTag;
void main() {
  vRow = uv;
  vLocal = aLocal;
  vRest = aRest;
  vKind = aKind;
  vTag = aTag;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

// Premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA): the glass darkens what is behind it a little, and
// the light (the text's glow, the brackets, the beams, the emitters) adds, all in one pass.
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uOn;
uniform float uDim;
uniform float uHot[${HOLO_TAGS.length}];
uniform float uOpen[${HOLO_TAGS.length}];
uniform float uSince[${HOLO_TAGS.length}];
uniform vec3 uTeal;
uniform vec3 uGlassLo;
uniform vec3 uGlassHi;
varying vec2 vRow;
varying vec2 vLocal;
varying vec2 vRest;
varying float vKind;
varying float vTag;

const vec2 OPEN = vec2(${LABEL.openW.toFixed(1)}, ${LABEL.openH.toFixed(1)});

// Tag i's value (a loop with a constant bound: the index is never dynamic, which GLSL ES 1.0 needs).
float pick(float v[${HOLO_TAGS.length}]) {
  float r = 0.0;
  for (int i = 0; i < ${HOLO_TAGS.length}; i++) r += v[i] * (1.0 - step(0.5, abs(float(i) - vTag)));
  return r;
}
float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float hot = pick(uHot);
  float since = pick(uSince);
  // Materialize: a stutter of on and off for a third of a second, coming up.
  float mat = since < 0.34 ? step(0.32, hash(floor(uTime * 36.0) + vTag * 7.0)) * (0.45 + since * 1.6) : 1.0;
  float flicker = 0.95 + 0.05 * sin(uTime * 29.0 + vTag * 2.1) * sin(uTime * 6.7 + vTag);
  float level = uOn * mix(1.0, 0.1, uDim) * mat * flicker;
  if (vKind < 0.5) {
    // The part of the unfolded quad shown now: the rest box, growing right and up as it opens.
    vec2 vis = mix(vRest, vec2(1.0), pick(uOpen));
    if (vLocal.x > vis.x || vLocal.y > vis.y) discard;
    vec2 size = vis * OPEN;
    // Label pixels from the shown box's top-left: the atlas row is read from the title down.
    vec2 p = vec2(vLocal.x * OPEN.x, (vis.y - vLocal.y) * OPEN.y);
    vec4 tex = texture2D(uMap, vec2(p.x / OPEN.x, vRow.y - (p.y / OPEN.y) * (vRow.y - vRow.x)));
    // Corner brackets: 7 px arms, a little over 1 px thick.
    vec2 d = min(p, size - p);
    float arm = 7.0 + 2.0 * hot;
    float bx = smoothstep(2.2, 1.0, d.x) * step(d.y, arm);
    float by = smoothstep(2.2, 1.0, d.y) * step(d.x, arm);
    float bracket = max(bx, by);
    float scan = step(0.5, fract(p.y / 3.0));
    float glassA = 0.8 + 0.08 * hot;
    vec3 glass = mix(uGlassLo, uGlassHi, 1.0 - p.y / max(size.y, 1.0));
    vec3 col = glass * glassA * (1.0 - tex.a) + tex.rgb * (1.0 + 0.3 * hot);
    col += uTeal * (bracket * (0.7 + 0.6 * hot) + scan * 0.016 * (1.0 - tex.a));
    float a = glassA * (1.0 - tex.a) + tex.a;
    gl_FragColor = vec4(col, a) * level;
  } else if (vKind < 1.5) {
    // The beam: slim and faint, a little brighter at the label.
    float y = clamp(vLocal.y, 0.0, 1.0);
    float across = abs(vLocal.x / max(vLocal.y, 1e-3));
    float soft = smoothstep(1.0, 0.2, across);
    float streak = 0.75 + 0.25 * sin(y * 30.0 - uTime * 4.0);
    float a = soft * streak * (0.07 + 0.08 * hot) * (0.6 + 0.6 * y);
    gl_FragColor = vec4(uTeal * a * level, 0.0);
  } else {
    float r = length(vLocal);
    float disc = smoothstep(1.0, 0.0, r);
    float ring = smoothstep(0.1, 0.0, abs(r - 0.66 - 0.05 * sin(uTime * 2.6 + vTag)));
    float a = (disc * disc * 0.35 + ring * 0.4) * (0.8 + 0.5 * hot);
    gl_FragColor = vec4(uTeal * a * level, 0.0);
  }
  #include <colorspace_fragment>
}`;

const N = HOLO_TAGS.length;

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
          uHot: { value: new Float32Array(N) },
          uOpen: { value: new Float32Array(N) },
          uSince: { value: new Float32Array(N).fill(NEVER) },
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
  const st = useRef({ on: 0, shown: false, dim: 0, hot: Array<number>(N).fill(0), open: Array<number>(N).fill(0), start: Array<number>(N).fill(-NEVER), hotWas: Array<boolean>(N).fill(false) });

  // The real fonts arriving reprint the atlas.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let live = true;
    Promise.all([fonts.load(`700 ${px(LABEL.titlePx)}px "Geist Mono"`), fonts.load(`400 ${px(LABEL.linePx)}px "Geist Mono"`)])
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
    if (on && !s.shown) for (let i = 0; i < N; i++) s.start[i] = now + i * 0.07;
    s.shown = on;
    s.on += ((on ? 1 : 0) - s.on) * (1 - Math.exp(-dt * 6));
    if (!on && s.on < 0.01) s.on = 0;
    s.dim += ((hiddenInstance() >= 0 ? 1 : 0) - s.dim) * (1 - Math.exp(-dt * 10));
    let busy = Math.abs((on ? 1 : 0) - s.on) > 0.01;
    HOLO_TAGS.forEach((t, i) => {
      const h = tagHot(t.id);
      if (h && !s.hotWas[i]) s.start[i] = now;
      s.hotWas[i] = h;
      const to = h ? 1 : 0;
      s.hot[i] += (to - s.hot[i]) * (1 - Math.exp(-dt * 12));
      // It unfolds a touch slower than it lights, so the line reads as coming out.
      s.open[i] += (to - s.open[i]) * (1 - Math.exp(-dt * 9));
      if (Math.abs(to - s.open[i]) < 0.002) s.open[i] = to;
      busy ||= Math.abs(to - s.hot[i]) > 0.01 || s.open[i] !== to || now - s.start[i] < 0.4;
    });
    u.uTime.value = now;
    u.uOn.value = s.on;
    u.uDim.value = s.dim;
    for (let i = 0; i < N; i++) {
      u.uHot.value[i] = s.hot[i];
      u.uOpen.value[i] = s.open[i];
      u.uSince.value[i] = now - s.start[i];
    }
    m.visible = s.on > 0;

    // The HTML buttons over the labels: the same box on screen, growing as it unfolds. drei mounts
    // them a little after the first frame, so each is checked against the size it was last given.
    if (on) {
      HOLO_TAGS.forEach((t, i) => {
        const el = wraps.current[i];
        if (!el) return;
        const r = projectLabel(t, camera, size.width, size.height, s.open[i]);
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
