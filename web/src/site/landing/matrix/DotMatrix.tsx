// "A demo becomes data" (sprint 9 T5): a frame of a physics replay dissolves into square ink dots as
// the reader scrolls past, the seam ragged and wandering, a few dots catching the accent. Our own take
// on a photo-to-dot-matrix shader, drawn on a 2D canvas. Reduced motion or Effects off: a still,
// half photo, half data.
import { useEffect, useRef, type RefObject } from "react";
import { useMotion } from "../../../sant/motion/MotionProvider";
import { cellSide, cellsFromPixels, scrollProgress, sectionProgress, seamColumn, twinkle, type Cell } from "./matrixCells";

/**
 * `progressFrom` drives the seam from another element's scroll, e.g. a section the figure is sticky in
 * (a stuck figure doesn't move, so its own position can't say how far the reader has come).
 */
export function DotMatrix({ src, label, progressFrom }: { src: string; label: string; progressFrom?: RefObject<HTMLElement> }) {
  const { reduced } = useMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const ctx = el?.getContext("2d");
    if (!el || !box || !ctx) return;

    const style = getComputedStyle(box);
    const ink = style.getPropertyValue("--sant-text").trim() || "#111111";
    const paper = style.getPropertyValue("--sant-bg").trim() || "#F4F1EA";
    const accent = style.getPropertyValue("--sant-accent").trim() || "#0B7A63";

    let frame = 0;
    let visible = false;
    let disposed = false;
    let cells: Cell[] = [];
    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const photo = document.createElement("canvas");
    const img = new Image();

    const prepare = () => {
      if (!img.naturalWidth) return;
      w = box.clientWidth;
      h = Math.round((w * img.naturalHeight) / img.naturalWidth);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.height = `${h}px`;
      cols = w < 560 ? 44 : 72;
      rows = Math.round((cols * img.naturalHeight) / img.naturalWidth);
      const small = document.createElement("canvas");
      small.width = cols;
      small.height = rows;
      const s = small.getContext("2d", { willReadFrequently: true });
      if (!s) return;
      s.drawImage(img, 0, 0, cols, rows);
      cells = cellsFromPixels(s.getImageData(0, 0, cols, rows).data, cols, rows);
      // The photo side is printed in ink tones, like the rest of the paper page.
      photo.width = el.width;
      photo.height = el.height;
      const p = photo.getContext("2d");
      if (!p) return;
      if ("filter" in p) p.filter = "grayscale(1) contrast(1.08)";
      p.imageSmoothingQuality = "high";
      p.drawImage(img, 0, 0, photo.width, photo.height);
    };

    const draw = (t: number) => {
      if (!cells.length) return;
      const driver = progressFrom?.current;
      const rect = (driver ?? box).getBoundingClientRect();
      const progress = reduced ? 0.5 : driver ? sectionProgress(rect.top, rect.height, window.innerHeight) : scrollProgress(rect.top, h, window.innerHeight);
      const cw = w / cols;
      const ch = h / rows;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) {
        const seam = seamColumn(r, progress, reduced ? 0 : t, cols);
        const y = r * ch;
        // One strip of photo for the row, then the data cells paint over it.
        const stripEnd = Math.min(w, Math.max(0, Math.ceil(seam + 3) * cw));
        if (stripEnd > 0) ctx.drawImage(photo, 0, y * dpr, stripEnd * dpr, ch * dpr + 1, 0, y, stripEnd, ch + 0.5);
        for (let c = Math.max(0, Math.floor(seam - 3)); c < cols; c++) {
          if (cellSide(c, r, seam) === "photo") continue;
          const x = c * cw;
          if (x < stripEnd) {
            ctx.fillStyle = paper;
            ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
          }
          const cell = cells[r * cols + c];
          const spark = reduced ? 0 : twinkle(c, r, t);
          const side = Math.min(cw, ch) * 0.86 * (cell.size + (1 - cell.size) * spark);
          ctx.fillStyle = cell.accent || spark > 0.3 ? accent : ink;
          ctx.fillRect(x + (cw - side) / 2, y + (ch - side) / 2, side, side);
        }
      }
    };

    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    const play = () => {
      if (reduced || frame || !visible || disposed) return;
      frame = requestAnimationFrame(loop);
    };
    const pause = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    img.onload = () => {
      if (disposed) return;
      prepare();
      draw(performance.now());
      play();
    };
    img.src = src;

    const ro = new ResizeObserver(() => {
      prepare();
      draw(performance.now());
    });
    ro.observe(box);
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([e]) => {
            visible = e.isIntersecting;
            if (visible) play();
            else pause();
          })
        : null;
    io?.observe(box);

    return () => {
      disposed = true;
      pause();
      ro.disconnect();
      io?.disconnect();
    };
  }, [src, reduced, progressFrom]);

  return (
    <div ref={wrap} className="sl-matrix">
      <canvas ref={canvas} className="sl-matrix__canvas" role="img" aria-label={label} />
    </div>
  );
}
