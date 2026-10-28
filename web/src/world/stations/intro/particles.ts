// The opening's dust as plain arrays (the Scene turns them into geometry), ported from the prototype
// (docs/design/prototypes/site-journey.html, buildDust): a sparse column around the logo's space that
// rises in the shader. A seeded random keeps every visit the same and makes it testable.
import { DUST } from "./layout";

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
