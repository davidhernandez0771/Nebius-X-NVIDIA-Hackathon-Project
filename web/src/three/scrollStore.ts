// One shared scroll value for the whole landing page. Lenis (or the native
// scroll fallback) writes it; the 3D scene, leader lines and DOM chapters all
// read it. `c` is the "chapter float": 0..6.99 where the integer part is the
// chapter index and the fraction is how far through it we are. The scene is
// keyed on `c`, not raw progress, so it stays in step with the measured layout.

export const CHAPTER_NAMES = [
  "Intro",
  "Scan",
  "Photograph",
  "Review",
  "Organize",
  "Ask",
  "Enter",
] as const;

export const CHAPTER_COUNT = CHAPTER_NAMES.length;

export const scroll = {
  /** 0..1 progress through the whole page */
  p: 0,
  /** chapter float, 0..CHAPTER_COUNT */
  c: 0,
  /** progress value at which each chapter's top hits the viewport top */
  starts: Array.from({ length: CHAPTER_COUNT }, (_, i) => i / CHAPTER_COUNT),
  /** pointer in -1..1, smoothed by the scene */
  pointer: { x: 0, y: 0 },
};

export function chapterFloat(p: number, starts: number[]): number {
  const n = starts.length;
  for (let i = n - 1; i >= 0; i--) {
    if (p >= starts[i]) {
      const end = i + 1 < n ? starts[i + 1] : 1;
      const span = Math.max(end - starts[i], 1e-4);
      return i + Math.min(1, (p - starts[i]) / span);
    }
  }
  return 0;
}

export function setProgress(p: number) {
  scroll.p = p;
  scroll.c = chapterFloat(p, scroll.starts);
}

/** Drive the scene directly (used by the entry sequence). */
export function setChapter(c: number) {
  scroll.c = c;
}
