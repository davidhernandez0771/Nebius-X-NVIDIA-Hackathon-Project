// What is printed on the pinch sheet, as one layout drawn two ways: onto a 2D canvas (the cloth's
// texture) and as an SVG string (the still version for reduced motion or no WebGL).
//
// Paper mode, from docs/design/design-system.md: ink #111111 on an off-white sheet that sits a
// step lighter than the #F4F1EA page, so it reads as a separate piece of fabric without a shadow.
// The print itself has no teal: teal means "live", so it only appears while someone holds the sheet.

export const PAPER = {
  ground: "#F4F1EA",
  sheet: "#FBF9F4",
  back: "#ECE7DC",
  ink: "#111111",
  muted: "#6B6760",
  line: "#CFC8BA",
  accent: "#0B7A63",
  accentInk: "#0A6E59",
} as const;

const FONT = '"Geist", "Inter", "Segoe UI", system-ui, sans-serif';

export interface PrintRun {
  role: "wordmark" | "line";
  text: string;
  /** Centre x and alphabetic baseline y, in texture pixels. */
  x: number;
  y: number;
  size: number;
  weight: number;
  color: string;
  /** Extra space between letters, in em. */
  tracking: number;
}

export interface PrintLayout {
  width: number;
  height: number;
  ground: string;
  /** A running stitch just inside the edge. */
  hem: { inset: number; color: string; width: number; dash: [number, number] };
  /** A faint woven grid, so the flat sheet still reads as cloth. */
  weave: { pitch: number; color: string; alpha: number };
  runs: PrintRun[];
}

export function printLayout(width: number, height: number): PrintLayout {
  const u = height / 640; // designed at 1024 x 640
  return {
    width,
    height,
    ground: PAPER.sheet,
    hem: { inset: 22 * u, color: PAPER.line, width: 2 * u, dash: [11 * u, 7 * u] },
    weave: { pitch: 5 * u, color: PAPER.ink, alpha: 0.028 },
    runs: [
      {
        role: "wordmark",
        text: "SANT",
        x: width / 2,
        y: 368 * u,
        size: 196 * u,
        weight: 600,
        color: PAPER.ink,
        tracking: 0.16,
      },
      {
        role: "line",
        text: "Simulate · Augment · Neaten · Train",
        x: width / 2,
        y: 456 * u,
        size: 30 * u,
        weight: 400,
        color: PAPER.muted,
        tracking: 0.02,
      },
    ],
  };
}

/** Draws the print onto a 2D context of size width x height. */
export function drawPrint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const L = printLayout(width, height);
  ctx.fillStyle = L.ground;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = L.weave.alpha;
  ctx.strokeStyle = L.weave.color;
  ctx.lineWidth = Math.max(1, L.weave.pitch * 0.2);
  ctx.beginPath();
  for (let x = 0; x <= width; x += L.weave.pitch) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += L.weave.pitch) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = L.hem.color;
  ctx.lineWidth = L.hem.width;
  ctx.setLineDash(L.hem.dash);
  const i = L.hem.inset;
  ctx.strokeRect(i, i, width - 2 * i, height - 2 * i);
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const run of L.runs) {
    ctx.fillStyle = run.color;
    ctx.font = `${run.weight} ${run.size}px ${FONT}`;
    const gap = run.tracking * run.size;
    if (run.role === "wordmark") {
      // letter by letter, so the tracking doesn't depend on canvas letterSpacing support
      const widths = Array.from(run.text, (ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
      let x = run.x - total / 2;
      Array.from(run.text).forEach((ch, k) => {
        ctx.fillText(ch, x, run.y);
        x += widths[k] + gap;
      });
    } else {
      ctx.textAlign = "center";
      ctx.fillText(run.text, run.x, run.y);
      ctx.textAlign = "left";
    }
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** The same print as an SVG string (still version). */
export function printSvg(width: number, height: number): string {
  const L = printLayout(width, height);
  const i = L.hem.inset;
  const p = L.weave.pitch;
  const runs = L.runs
    .map((r) => {
      const ls = r.tracking * r.size;
      // letter-spacing also trails the last letter; shift by half of it to stay centred
      return `<text x="${r.x + ls / 2}" y="${r.y}" text-anchor="middle" font-family='${FONT}' font-size="${r.size}" font-weight="${r.weight}" letter-spacing="${ls}" fill="${r.color}">${esc(r.text)}</text>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" aria-hidden="true">` +
    `<defs><pattern id="pinch-sheet-weave" width="${p}" height="${p}" patternUnits="userSpaceOnUse">` +
    `<path d="M0 0H${p}M0 0V${p}" stroke="${L.weave.color}" stroke-opacity="${L.weave.alpha}" stroke-width="${Math.max(1, p * 0.2)}"/></pattern></defs>` +
    `<rect width="${width}" height="${height}" fill="${L.ground}"/>` +
    `<rect width="${width}" height="${height}" fill="url(#pinch-sheet-weave)"/>` +
    `<rect x="${i}" y="${i}" width="${width - 2 * i}" height="${height - 2 * i}" fill="none" stroke="${L.hem.color}" stroke-width="${L.hem.width}" stroke-dasharray="${L.hem.dash.join(" ")}"/>` +
    runs +
    `</svg>`
  );
}
