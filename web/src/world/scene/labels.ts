// The cartridge labels, drawn once into one canvas atlas (the label text isn't baked: README in
// docs/design/blender/export). Tiles 0–4 are the five robots, in ROBOTS order; tiles 5–7 are plain
// library labels. The label mesh is UV-mapped 0–1, so each instance reads its tile through a UV
// offset and scale (tileUv). The look follows the B-focus render: a dark band reading "SANT · ROBOT
// CARTRIDGE", the code large and light, the robot's line under it, a status square and a barcode.
import { ROBOTS } from "./robots";

/** The label's printed aspect (the label mesh is scaled 1.88 x 1.38). */
export const LABEL_ASPECT = 1.88 / 1.38;
export const COLS = 4;
export const ROWS = 2;
export const TILE_W = 512;
export const TILE_H = Math.round(TILE_W / LABEL_ASPECT);
export const LIBRARY_TILES = [5, 6, 7] as const;
export const TILE_COUNT = COLS * ROWS;

/** UV offset and scale for a tile, for a texture uploaded with flipY (row 0 at the top). */
export function tileUv(tile: number): { u: number; v: number; su: number; sv: number } {
  if (!(tile >= 0 && tile < TILE_COUNT)) throw new Error(`world: no label tile ${tile}`);
  const col = tile % COLS;
  const row = Math.floor(tile / COLS);
  return { u: col / COLS, v: 1 - (row + 1) / ROWS, su: 1 / COLS, sv: 1 / ROWS };
}

export interface LabelArt {
  code: string;
  line: string;
  mark: string;
  serial: string;
}

/** What each tile prints. */
export function labelArt(tile: number): LabelArt {
  const r = ROBOTS[tile];
  if (r) return { code: r.code, line: r.spec.toUpperCase(), mark: r.mark, serial: `SANT-${String(101 + tile * 37).padStart(4, "0")}` };
  const n = tile - ROBOTS.length;
  return { code: ["DEMO", "COPY", "TEST"][n] ?? "SANT", line: ["ONE HUMAN DEMO", "VERIFIED COPY", "PHYSICS CHECK"][n] ?? "", mark: "#5E6A77", serial: `LIB-${String(n + 1).padStart(3, "0")}` };
}

const PAPER = "#DCD9D1";
const INK = "#16181B";
const BAND = "#1B1E22";

/** A barcode that is the same for the same text. */
function bars(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let at = x;
  while (at < x + w) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const bw = 2 + ((seed >>> 16) % 4);
    if ((seed >>> 8) % 3 !== 0) g.fillRect(at, y, bw, h);
    at += bw + 2;
  }
}

function drawTile(g: CanvasRenderingContext2D, tile: number) {
  const art = labelArt(tile);
  const x0 = (tile % COLS) * TILE_W;
  const y0 = Math.floor(tile / COLS) * TILE_H;
  const W = TILE_W;
  const H = TILE_H;
  const pad = W * 0.06;
  g.save();
  g.translate(x0, y0);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // The band across the top.
  g.fillStyle = BAND;
  g.fillRect(0, 0, W, H * 0.12);
  g.fillStyle = "#C9CED4";
  g.font = `500 ${Math.round(H * 0.055)}px Geist, system-ui, sans-serif`;
  g.textBaseline = "middle";
  g.fillText("SANT  ·  ROBOT CARTRIDGE", pad, H * 0.06);
  // The code, large and light.
  g.fillStyle = INK;
  g.textBaseline = "alphabetic";
  const size = Math.round(H * (art.code.length > 3 ? 0.27 : 0.32));
  g.font = `300 ${size}px Geist, system-ui, sans-serif`;
  g.fillText(art.code, pad - size * 0.04, H * 0.5);
  // The robot's line, the status square.
  g.font = `400 ${Math.round(H * 0.052)}px Geist, system-ui, sans-serif`;
  g.fillStyle = "#3A3F45";
  g.fillText(art.line, pad, H * 0.64);
  g.fillStyle = art.mark;
  g.fillRect(W - pad - H * 0.07, H * 0.53, H * 0.07, H * 0.07);
  // The serial and the barcode along the bottom.
  g.fillStyle = "#4A5057";
  g.font = `400 ${Math.round(H * 0.045)}px "Geist Mono", ui-monospace, monospace`;
  g.fillText(art.serial, pad, H * 0.9);
  g.fillStyle = INK;
  bars(g, art.serial + art.code, W * 0.52, H * 0.79, W * 0.48 - pad, H * 0.12);
  g.restore();
}

/** Draws every tile into `canvas` (sized here). Call again once the fonts arrive. */
export function drawAtlas(canvas: HTMLCanvasElement): boolean {
  canvas.width = COLS * TILE_W;
  canvas.height = ROWS * TILE_H;
  const g = canvas.getContext("2d");
  if (!g) return false;
  for (let t = 0; t < TILE_COUNT; t++) drawTile(g, t);
  return true;
}
