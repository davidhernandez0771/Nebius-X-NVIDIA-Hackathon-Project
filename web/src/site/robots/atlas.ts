// One shared texture for every cartridge label: a padded grid of cells, so all labels draw with one material
// (and one draw call) instead of one 640 × 512 texture each.

export type AtlasRect = { x: number; y: number; w: number; h: number };

/** n cells of cellW × cellH, `pad` px of air around each, rows no wider than maxWidth. */
export function atlasLayout(n: number, cellW: number, cellH: number, pad: number, maxWidth: number) {
  const pitchW = cellW + 2 * pad, pitchH = cellH + 2 * pad;
  const cols = Math.max(1, Math.min(n, Math.floor(maxWidth / pitchW)));
  const rows = Math.ceil(n / cols);
  const rects: AtlasRect[] = [];
  for (let i = 0; i < n; i++) rects.push({ x: (i % cols) * pitchW + pad, y: Math.floor(i / cols) * pitchH + pad, w: cellW, h: cellH });
  return { width: cols * pitchW, height: rows * pitchH, cols, rects };
}

/** uv offset and scale [u0, v0, su, sv] of a cell, for a texture uploaded with flipY (v = 0 at the canvas bottom). */
export function atlasUv(r: AtlasRect, W: number, H: number): [number, number, number, number] {
  return [r.x / W, 1 - (r.y + r.h) / H, r.w / W, r.h / H];
}
