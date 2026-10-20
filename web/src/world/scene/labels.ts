// The cartridge labels, drawn once into one canvas atlas (the label text isn't baked: README in
// docs/design/blender/export). Tiles 0–4 are the five robots, in ROBOTS order; tiles 5–7 are plain
// library labels; tiles 8–31 are the jobs on the spiral (items.ts), in ITEMS order; tiles 32–35 are
// the cartridges saved on the workbench (saved.ts), one per empty place on the spiral, redrawn when
// one is saved or removed; tile 36 is the draft on the bench's turntable (the room view's copy),
// redrawn when the bench closes on a changed draft. The label mesh is UV-mapped 0–1, so each instance reads its tile through a UV
// offset and scale (tileUv). The look follows the B-focus render: a dark band reading "SANT · ROBOT
// CARTRIDGE", the code large and light, the robot's line under it, a status square and a barcode.
import { ITEMS, TAG_COLOR, tagLabel } from "./items";
import { ROBOTS, robotFor } from "./robots";
import { MAX_SAVED, savedCartridges, type Draft } from "./saved";

/** The label's printed aspect (the label mesh is scaled 1.88 x 1.38). */
export const LABEL_ASPECT = 1.88 / 1.38;
export const COLS = 4;
export const ROWS = 10;
/** 384 px per tile keeps the 36-tile atlas at 1536 x 2538 (about 16 MB on the GPU, 21 with mips). */
export const TILE_W = 384;
export const TILE_H = Math.round(TILE_W / LABEL_ASPECT);
export const LIBRARY_TILES = [5, 6, 7] as const;
/** The first job's tile; job i (ITEMS order) is ITEM_TILE0 + i. */
export const ITEM_TILE0 = 8;
/** The first saved cartridge's tile; place i (saved.ts) is SAVED_TILE0 + i. */
export const SAVED_TILE0 = 32;
/** The bench's draft, standing on the turntable in the room view. */
export const DRAFT_TILE = SAVED_TILE0 + MAX_SAVED;
export const TILE_COUNT = COLS * ROWS;

/** UV offset and scale for a tile, for a texture uploaded with flipY (row 0 at the top). */
export function tileUv(tile: number): { u: number; v: number; su: number; sv: number } {
  if (!(tile >= 0 && tile < TILE_COUNT)) throw new Error(`world: no label tile ${tile}`);
  const col = tile % COLS;
  const row = Math.floor(tile / COLS);
  return { u: col / COLS, v: 1 - (row + 1) / ROWS, su: 1 / COLS, sv: 1 / ROWS };
}

export interface LabelArt {
  /** The band across the top. */
  band: string;
  code: string;
  line: string;
  mark: string;
  serial: string;
}

/**
 * A workbench cartridge's label: the name large, its robot's line under it, the robot's square. A
 * draft with no name yet prints the render's blank: a plus and "name your robot".
 */
export function draftArt(d: Draft, place = -1): LabelArt {
  const r = robotFor(d.robot);
  const name = d.name.trim().toUpperCase();
  return {
    band: "SANT  ·  YOUR CARTRIDGE",
    code: name || "+",
    line: name ? r.spec.toUpperCase() : `NAME YOUR ROBOT  ·  ${r.name.toUpperCase()}`,
    mark: r.mark,
    serial: place >= 0 ? `MINE-${String(place + 1).padStart(3, "0")}` : "MINE-NEW",
  };
}

/** An empty place's tile: nothing stands there on the spiral, but the tile stays valid. */
const BLANK: LabelArt = { band: "SANT  ·  YOUR CARTRIDGE", code: "+", line: "MAKE ONE ON THE BENCH", mark: "#5E6A77", serial: "MINE-000" };

/** A draft with nothing chosen yet: what the turntable holds before the bench is first opened. */
const FRESH_DRAFT: LabelArt = draftArt({ name: "", shell: "graphite", robot: ROBOTS[0].code });
let draftTile: LabelArt | null = null;

/** What the draft tile prints from now on (null: a fresh draft). Redraw it with drawDraftTile. */
export function setDraftTileArt(art: LabelArt | null): void {
  draftTile = art;
}

/** What each tile prints. */
export function labelArt(tile: number): LabelArt {
  if (tile === DRAFT_TILE) return draftTile ?? FRESH_DRAFT;
  if (tile >= SAVED_TILE0) {
    const place = tile - SAVED_TILE0;
    const c = savedCartridges()[place];
    return c ? draftArt(c, place) : BLANK;
  }
  const r = ROBOTS[tile];
  if (r) return { band: "SANT  ·  ROBOT CARTRIDGE", code: r.code, line: r.spec.toUpperCase(), mark: r.mark, serial: `SANT-${String(101 + tile * 37).padStart(4, "0")}` };
  const it = ITEMS[tile - ITEM_TILE0];
  if (it)
    return {
      band: `SANT  ·  ${tagLabel(it.tag).toUpperCase()}`,
      code: it.title,
      line: `${it.sub.toUpperCase()}  ·  ${it.robot}`,
      mark: TAG_COLOR[it.tag],
      serial: `S·A·N·T  ${String(tile - ITEM_TILE0 + 1).padStart(2, "0")}`,
    };
  const n = tile - ROBOTS.length;
  return { band: "SANT  ·  ROBOT CARTRIDGE", code: ["DEMO", "COPY", "TEST"][n] ?? "SANT", line: ["ONE HUMAN DEMO", "VERIFIED COPY", "PHYSICS CHECK"][n] ?? "", mark: "#5E6A77", serial: `LIB-${String(n + 1).padStart(3, "0")}` };
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

/** Prints one label at (x0, y0), W x H. */
function drawLabel(g: CanvasRenderingContext2D, art: LabelArt, x0: number, y0: number, W = TILE_W, H = TILE_H) {
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
  g.fillText(art.band, pad, H * 0.06);
  // The code, large and light.
  g.fillStyle = INK;
  g.textBaseline = "alphabetic";
  let size = Math.round(H * (art.code.length > 3 ? 0.27 : 0.32));
  g.font = `300 ${size}px Geist, system-ui, sans-serif`;
  // Long job names shrink to fit the label.
  while (size > H * 0.12 && g.measureText(art.code).width > W - 2 * pad) g.font = `300 ${--size}px Geist, system-ui, sans-serif`;
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

function drawTile(g: CanvasRenderingContext2D, tile: number) {
  drawLabel(g, labelArt(tile), (tile % COLS) * TILE_W, Math.floor(tile / COLS) * TILE_H);
}

/** Redraws the saved cartridges' tiles only (after a save or a remove). */
export function drawSavedTiles(canvas: HTMLCanvasElement): boolean {
  const g = canvas.getContext("2d");
  if (!g) return false;
  for (let i = 0; i < MAX_SAVED; i++) drawTile(g, SAVED_TILE0 + i);
  return true;
}

/** Redraws the draft tile only (the bench closed on a changed draft). */
export function drawDraftTile(canvas: HTMLCanvasElement): boolean {
  const g = canvas.getContext("2d");
  if (!g) return false;
  drawTile(g, DRAFT_TILE);
  return true;
}

/** One label on its own canvas, `scale` times a tile's size (the bench's cartridge, the printer's label). */
export function drawSingle(canvas: HTMLCanvasElement, art: LabelArt, scale = 1): boolean {
  const W = Math.round(TILE_W * scale);
  const H = Math.round(TILE_H * scale);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return false;
  drawLabel(g, art, 0, 0, W, H);
  return true;
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
