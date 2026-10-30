// The film's clock maths and subtitles: pure functions of time, so a frame at t always looks the same (the renderer
// seeks the page frame by frame; video/render.mjs).

export type Word = { t: number; d: number; w: string };
export type Line = { key: string; start: number; end: number; text: string; words: Word[] };
export type SceneSpan = { id: string; start: number; end: number; lines: Line[] };
export type Timeline = { fps: number; width: number; height: number; duration: number; scenes: SceneSpan[] };

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** 0 before a, 1 after b, linear between. */
export const ramp = (t: number, a: number, b: number) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x: number) => {
  const v = clamp(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
/** An eased 0→1 over [a, a + dur]. */
export const enter = (t: number, a: number, dur = 0.6) => easeOut(ramp(t, a, a + dur));
/** In at a, out at b: 0→1→0 with eased edges. */
export const window_ = (t: number, a: number, b: number, edge = 0.5) => Math.min(enter(t, a, edge), 1 - easeInOut(ramp(t, b - edge, b)));
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** When a spoken word (or the first of a phrase) starts, in film seconds; the line's start if it isn't found. */
export function wordAt(line: Line, phrase: string, nth = 0): number {
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  let seen = 0;
  for (let i = 0; i < line.words.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) if (norm(line.words[i + j]?.w ?? "") !== want[j]) ok = false;
    if (ok && seen++ === nth) return line.words[i].t;
  }
  return line.start;
}

export type Caption = { start: number; end: number; text: string };

/**
 * The line's text cut into captions of at most `max` characters, breaking after punctuation where it can, each timed by
 * the spoken words it holds (the text keeps its punctuation; the word timings come from the voice).
 */
export function captions(line: Line, max = 46): Caption[] {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  // the time each token starts: walk the spoken words alongside the tokens
  const times: number[] = [];
  const ends: number[] = [];
  let k = 0;
  for (const tok of tokens) {
    const want = norm(tok);
    const at = line.words[Math.min(k, line.words.length - 1)];
    times.push(at ? at.t : line.start);
    let got = "";
    let last = at;
    while (k < line.words.length && got.length < want.length) {
      last = line.words[k];
      got += norm(line.words[k].w);
      k++;
      if (!want.startsWith(got)) break;
    }
    if (!want) k = Math.max(0, k);
    ends.push(last ? last.t + last.d : line.end);
  }
  const out: Caption[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: times[cur[0]], end: ends[cur[cur.length - 1]], text: cur.map((i) => tokens[i]).join(" ") });
    cur = [];
  };
  tokens.forEach((tok, i) => {
    const text = [...cur.map((j) => tokens[j]), tok].join(" ");
    if (cur.length && text.length > max) flush();
    cur.push(i);
    const soft = /[,:;]$/.test(tok) && cur.map((j) => tokens[j]).join(" ").length > max * 0.45;
    if (/[.!?]$/.test(tok) || soft) flush();
  });
  flush();
  // each caption holds until the next one starts (or a beat after its last word)
  return out.map((c, i) => ({ ...c, end: i + 1 < out.length ? out[i + 1].start : Math.max(c.end + 0.25, line.end) }));
}

/** The caption on screen at t, if any. */
export function captionAt(tl: Timeline, t: number): string | null {
  for (const s of tl.scenes)
    for (const l of s.lines) {
      if (t < l.start || t > l.end + 0.3) continue;
      const c = captions(l).find((c) => t >= c.start && t < c.end);
      if (c) return c.text;
    }
  return null;
}

/** The scenes drawn at t: the current one and, during a cross-fade, its neighbour, with their opacities. */
export function scenesAt(tl: Timeline, t: number, fade = 0.5): { span: SceneSpan; alpha: number }[] {
  const out: { span: SceneSpan; alpha: number }[] = [];
  tl.scenes.forEach((s, i) => {
    const first = i === 0;
    const last = i === tl.scenes.length - 1;
    const a = first ? (t >= s.start ? 1 : 0) : ramp(t, s.start - fade / 2, s.start + fade / 2);
    const b = last ? (t <= s.end + 5 ? 1 : 0) : 1 - ramp(t, s.end - fade / 2, s.end + fade / 2);
    const alpha = Math.min(a, b);
    if (alpha > 0) out.push({ span: s, alpha });
  });
  return out;
}
