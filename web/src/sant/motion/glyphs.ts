// The glyph loader's text (GlyphLoader.tsx): a label that resolves from the left out of rows of
// loader glyphs, instead of a spinner. Pure, so a given tick always draws the same string.

export const GLYPHS = "/\\|-_:+";

export function resolveGlyphs(text: string, resolved: number, tick: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i < resolved || ch === " " ? ch : GLYPHS[(i * 7 + tick * 3 + (i ^ tick)) % GLYPHS.length];
  }
  return out;
}
