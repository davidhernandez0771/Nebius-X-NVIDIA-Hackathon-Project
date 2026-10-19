// The opening's particles as plain arrays (the Scene turns them into geometry), ported from the
// prototype (docs/design/prototypes/site-journey.html, buildLogoPoints and buildDust). A seeded random
// keeps every visit the same and makes the shapes testable.
// - The logo: 60% on the mark (any white-on-transparent image, sampled by sampleMark), 40% in two
//   plumes under it. Each point also carries where it lands in the roof lattice (aRoof) and four
//   random numbers (aRand) for the shader's timing and colour.
// - The dust: a column around the journey; it rises in the shader.
import { DUST, LOGO, LOGO_SCALE, ROOF, SKYLIGHT } from "./layout";

const TAU = Math.PI * 2;

/** A small seeded random (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/**
 * The pixels of a mark image with alpha over `threshold`, as (x, y) pairs centred on the image, y up.
 * `data` is RGBA (getImageData). Every `stride`-th pixel, so a big image doesn't make a huge list.
 */
export function sampleMark(data: ArrayLike<number>, width: number, height: number, threshold = 128, stride = 1): Float32Array {
  const out: number[] = [];
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) if (data[(y * width + x) * 4 + 3] > threshold) out.push(x - width / 2, height / 2 - y);
  return new Float32Array(out);
}

/** The mark is sampled at 512 px: this many prototype units per pixel. */
export const MARK_UNITS = 4.2 / 230;

/** One point of the roof lattice, in world coordinates: rings, spokes from the skylight, a little fill. */
export function roofPoint(rnd: () => number): [number, number, number] {
  const R0 = ROOF.radius;
  const inner = SKYLIGHT.radius + 0.9;
  const rings = Math.floor(R0 / ROOF.ringStep);
  let r: number;
  let a: number;
  const m = rnd();
  if (m < 0.45) {
    r = (1 + Math.floor(rnd() * rings)) * ROOF.ringStep;
    a = rnd() * TAU;
  } else if (m < 0.88) {
    a = (Math.floor(rnd() * ROOF.spokes) * TAU) / ROOF.spokes;
    r = inner + rnd() * (R0 - inner);
  } else {
    r = inner + Math.sqrt(rnd()) * (R0 - inner);
    a = rnd() * TAU;
  }
  r = Math.min(R0, r + (rnd() - 0.5) * 0.07);
  const y = ROOF.y + ROOF.rise * (1 - (r / R0) ** 2) + (rnd() - 0.5) * 0.06;
  return [Math.sin(a) * r, y, Math.cos(a) * r];
}

export interface LogoBuffers {
  /** Local to the logo (prototype units; the Points object sits at LOGO, scaled by LOGO_SCALE). */
  position: Float32Array;
  /** The roof point, in the same local units. */
  roof: Float32Array;
  rand: Float32Array;
}

export function logoBuffers(mark: Float32Array, n: number, seed = 7): LogoBuffers {
  const rnd = seeded(seed);
  const position = new Float32Array(n * 3);
  const roof = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  const M = mark.length / 2;
  for (let i = 0; i < n; i++) {
    let x: number;
    let y: number;
    let z: number;
    if (M > 0 && rnd() < 0.6) {
      const j = Math.floor(rnd() * M);
      x = (mark[2 * j] + rnd() - 0.5) * MARK_UNITS;
      y = (mark[2 * j + 1] + rnd() - 0.5) * MARK_UNITS;
      z = (rnd() - 0.5) * 0.16;
    } else {
      const side = rnd() < 0.5 ? -1 : 1;
      x = side * (2.8 + Math.abs(gauss(rnd)) * 2.3);
      y = -6.6 + gauss(rnd) * 2.1;
      z = gauss(rnd) * 1.5;
    }
    position.set([x, y, z], i * 3);
    const r = roofPoint(rnd);
    roof.set([(r[0] - LOGO[0]) / LOGO_SCALE, (r[1] - LOGO[1]) / LOGO_SCALE, (r[2] - LOGO[2]) / LOGO_SCALE], i * 3);
    rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  return { position, roof, rand };
}

export interface DustBuffers {
  position: Float32Array;
  rand: Float32Array;
}

export function dustBuffers(n: number, seed = 11): DustBuffers {
  const rnd = seeded(seed);
  const position = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rnd()) * DUST.radius;
    const a = rnd() * TAU;
    position.set([Math.sin(a) * r, DUST.y0 + rnd() * DUST.height, Math.cos(a) * r], i * 3);
    rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  return { position, rand };
}

/** The placeholder mark, drawn into a 2D context (used when the mark image can't load). */
export function drawPlaceholderMark(g: CanvasRenderingContext2D, size: number): void {
  const s = size / 512;
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(s, s);
  g.strokeStyle = g.fillStyle = "#fff";
  g.lineCap = "round";
  g.lineWidth = 22;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.arc(0, 0, 128, (k * TAU) / 4 + 0.34, ((k + 1) * TAU) / 4 - 0.34);
    g.stroke();
  }
  g.lineWidth = 14;
  for (let k = 0; k < 4; k++) {
    const a = (k * TAU) / 4 + TAU / 8;
    g.beginPath();
    g.moveTo(Math.cos(a) * 58, Math.sin(a) * 58);
    g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, -28);
  g.lineTo(28, 0);
  g.lineTo(0, 28);
  g.lineTo(-28, 0);
  g.closePath();
  g.fill();
  g.restore();
}
