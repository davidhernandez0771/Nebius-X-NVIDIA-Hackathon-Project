// The "X-ray" look for the sim's camera frames: the bright scene goes dark, edges glow in ink, the
// red cube is painted in the side's colour (amber raw, teal perfected) and its box is measured from
// the pixels, so the detection boxes lock on to where the cube really is in each frame.

export interface Tone {
  ink: [number, number, number];
  cube: [number, number, number];
  bin: [number, number, number];
}

export const TONES: Record<"raw" | "perfected", Tone> = {
  raw: { ink: [230, 237, 243], cube: [255, 176, 0], bin: [74, 86, 102] },
  perfected: { ink: [196, 255, 238], cube: [25, 245, 194], bin: [60, 96, 92] },
};

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const lum = (d: Uint8ClampedArray, i: number) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

export function xrayPixels(src: Uint8ClampedArray, w: number, h: number, tone: Tone) {
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = lum(src, p * 4);
  const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const data = new Uint8ClampedArray(w * h * 4);
  let cube: Box | null = null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const [r, g, b] = [src[i], src[i + 1], src[i + 2]];
      // Sobel edge strength, softened so the floor's checker lines stay a quiet grid.
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const e = Math.min(1, Math.pow(Math.hypot(gx, gy) * 0.6, 1.6)) * 0.8;
      const v = Math.min(1, e + (1 - L[p]) * 0.42);
      let out: [number, number, number] = [tone.ink[0] * v, tone.ink[1] * v, tone.ink[2] * v];
      if (r > 140 && g < 110 && b < 110) {
        out = tone.cube;
        cube = cube
          ? { x0: Math.min(cube.x0, x), y0: Math.min(cube.y0, y), x1: Math.max(cube.x1, x), y1: Math.max(cube.y1, y) }
          : { x0: x, y0: y, x1: x, y1: y };
      } else if (b > 170 && r < 140) {
        out = [out[0] * 0.45 + tone.bin[0], out[1] * 0.45 + tone.bin[1], out[2] * 0.45 + tone.bin[2]];
      }
      data[i] = out[0];
      data[i + 1] = out[1];
      data[i + 2] = out[2];
      data[i + 3] = 255;
    }
  return { data, cube };
}

export interface XrayFrame {
  canvas: HTMLCanvasElement;
  cube: Box | null;
}

/** Cuts a sprite sheet into frames and X-rays each one. Runs once per sheet. */
export function xraySheet(img: HTMLImageElement, sheet: { count: number; cols: number; w: number; h: number }, tone: Tone): XrayFrame[] {
  const src = document.createElement("canvas");
  src.width = sheet.w;
  src.height = sheet.h;
  const sx = src.getContext("2d", { willReadFrequently: true });
  if (!sx) return [];
  const frames: XrayFrame[] = [];
  for (let k = 0; k < sheet.count; k++) {
    sx.clearRect(0, 0, sheet.w, sheet.h);
    sx.drawImage(img, (k % sheet.cols) * sheet.w, Math.floor(k / sheet.cols) * sheet.h, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
    const { data, cube } = xrayPixels(sx.getImageData(0, 0, sheet.w, sheet.h).data, sheet.w, sheet.h, tone);
    const c = document.createElement("canvas");
    c.width = sheet.w;
    c.height = sheet.h;
    c.getContext("2d")?.putImageData(new ImageData(data, sheet.w, sheet.h), 0, 0);
    frames.push({ canvas: c, cube });
  }
  return frames;
}
