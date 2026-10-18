// The select HUD, ported line for line from docs/design/prototypes/robot-shelf.html (the user called it perfect):
// tilted orbits with travelling dots, light streaks, the frame, mosaic tiles in the robot's own palette and effect,
// crosshair "×" boxes, x/y coordinates and the scrambling title block. Only the fonts changed (see fonts.ts), and
// the lock-on point is nudged to keep the frame on small screens (hudAnchor.ts).
import type { Robot } from "./robots";
import { MONO, SANS } from "./fonts";
import { rnd } from "./spiral";
import { hudAnchor, hudFrame } from "./hudAnchor";

type Tile = { u: number; v: number; w: number; h: number; kind: "img" | "dots" | "cross"; delay: number; sx: number; sy: number };
type Orbit = { rx: number; ry: number; rot: number; dash: number[]; sp: number };

const ORBITS: Orbit[] = [
  { rx: 1.05, ry: 0.42, rot: -0.32, dash: [2, 5], sp: 0.35 },
  { rx: 0.62, ry: 1.08, rot: 0.18, dash: [], sp: -0.25 },
  { rx: 1.22, ry: 0.7, rot: 0.9, dash: [1, 7], sp: 0.18 },
];

function scramble(s: string, p: number): string {
  const ch = "░▒/<>_-=01";
  return s
    .split("")
    .map((c, k) => (c === " " || k / s.length < p ? c : ch[(Math.random() * ch.length) | 0]))
    .join("");
}

export class Hud {
  private art = document.createElement("canvas");
  private ax: CanvasRenderingContext2D | null;
  private tiles: Tile[] = [];
  private robot: Robot | null = null;
  private born = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private dpr: number,
    private reduce: boolean,
  ) {
    this.art.width = 240;
    this.art.height = 150;
    this.ax = this.art.getContext("2d");
  }

  setReduce(reduce: boolean) {
    this.reduce = reduce;
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
  }

  select(robot: Robot | null, index: number, now: number) {
    this.robot = robot;
    this.born = now;
    if (!robot) return;
    this.paintArt(robot);
    this.makeTiles(robot, index + 1);
  }

  clear() {
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private paintArt(r: Robot) {
    const ax = this.ax;
    if (!ax) return;
    const p = r.pal, gr = ax.createLinearGradient(0, 0, 240, 150);
    gr.addColorStop(0, p[0]); gr.addColorStop(0.55, p[3]); gr.addColorStop(1, p[1]);
    ax.fillStyle = gr; ax.fillRect(0, 0, 240, 150);
    ax.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < 240; i += 6) ax.fillRect(i, 0, 1, 150);
    ax.strokeStyle = p[2]; ax.lineWidth = 7; ax.lineCap = "round"; ax.lineJoin = "round";
    ax.beginPath(); ax.moveTo(70, 140); ax.lineTo(70, 98); ax.lineTo(92, 60); ax.lineTo(140, 42); ax.lineTo(176, 62); ax.lineTo(184, 88); ax.stroke();
    ax.fillStyle = p[1]; ax.fillRect(176, 88, 18, 10); ax.beginPath(); ax.arc(196, 112, 9, 0, 7); ax.fill();
    ax.fillStyle = "rgba(0,0,0,.35)"; ax.fillRect(0, 118, 240, 32);
    ax.fillStyle = p[2]; ax.font = `700 16px ${SANS}`; ax.fillText(r.code, 10, 140);
  }

  private makeTiles(r: Robot, seed: number) {
    this.tiles = [];
    for (let i = 0; i < 16; i++) {
      const s = seed * 31 + i * 7.3;
      let kind: Tile["kind"] = rnd(s) < 0.2 ? "cross" : rnd(s + 1) < 0.25 && r.fx !== "scan" ? "dots" : "img";
      if (r.fx === "dots" && rnd(s + 9) < 0.35) kind = "dots";
      this.tiles.push({ u: rnd(s + 2) * 0.9 - 0.05, v: rnd(s + 3) * 0.85 - 0.02, w: 0.08 + rnd(s + 4) * 0.32, h: 0.07 + rnd(s + 5) * 0.26, kind, delay: rnd(s + 6) * 0.7, sx: rnd(s + 7), sy: rnd(s + 8) });
    }
  }

  /** Draws the HUD locked on the picked cartridge at CSS pixel (cx, cy); t is the scene clock in seconds. */
  draw(cx: number, cy: number, t: number, now: number) {
    const hx = this.canvas.getContext("2d");
    if (!hx) return;
    const W = this.canvas.width, H = this.canvas.height;
    hx.clearRect(0, 0, W, H);
    const r = this.robot;
    if (!r) return;
    const reduce = this.reduce, d = this.dpr, art = this.art, hudC = this.canvas;
    const age = Math.min(1, (now - this.born) / 1100);
    ({ cx, cy } = hudAnchor(cx * d, cy * d, W, H, d));
    const { R, fw, fh } = hudFrame(W, H), fx = cx - fw * 0.5, fy = cy - fh * 0.55;
    hx.lineWidth = 1 * d;
    // orbits with travelling dots
    ORBITS.forEach((o, j) => {
      hx.save(); hx.translate(cx, cy); hx.rotate(o.rot + (reduce ? 0 : t * 0.03 * (j % 2 ? -1 : 1)));
      hx.setLineDash(o.dash.map((x) => x * d)); hx.strokeStyle = "rgba(237,237,234," + 0.35 * age + ")";
      hx.beginPath(); hx.ellipse(0, 0, R * o.rx * age, R * o.ry * age, 0, 0, Math.PI * 2); hx.stroke(); hx.setLineDash([]);
      for (let s = 0; s < 2; s++) { const a = reduce ? s * 3 : t * o.sp + s * 3.1 + j; hx.fillStyle = "#ededea"; hx.beginPath(); hx.arc(Math.cos(a) * R * o.rx * age, Math.sin(a) * R * o.ry * age, 2.2 * d, 0, 7); hx.fill(); }
      hx.restore();
    });
    // light streaks
    hx.strokeStyle = "rgba(255,255,255," + 0.55 * age + ")"; hx.lineWidth = 2 * d;
    hx.beginPath(); hx.moveTo(fx + fw * 0.12, fy + fh * 0.95); hx.lineTo(fx + fw * 0.34, fy + fh * 0.25); hx.stroke();
    hx.beginPath(); hx.moveTo(fx + fw * 0.22, fy + fh * 1.02); hx.lineTo(fx + fw * 0.4, fy + fh * 0.45); hx.stroke(); hx.lineWidth = 1 * d;
    // main frame
    hx.strokeStyle = "rgba(237,237,234,.6)"; hx.strokeRect(fx, fy, fw * age, fh);
    // tiles
    this.tiles.forEach((tl, n) => {
      const a = Math.max(0, Math.min(1, (age - tl.delay * 0.6) / 0.4));
      if (a <= 0) return;
      const x = fx + tl.u * fw, y2 = fy + tl.v * fh, w = tl.w * fw, h = tl.h * fh;
      const flick = reduce ? 1 : Math.sin(t * 9 + n * 2.3) > 0.92 ? 0.35 : 1;
      hx.globalAlpha = a * flick;
      if (tl.kind === "img") {
        const block = Math.max(1, Math.round((r.fx === "blocks" ? 18 : 12) * Math.pow(1 - a, 1.5) + (r.fx === "blocks" ? 6 : 2)));
        hx.imageSmoothingEnabled = false;
        hx.drawImage(art, tl.sx * 160, tl.sy * 90, 80, 60, x, y2, w, h);
        if (block > 1) {
          const tmp = hx.getImageData(Math.max(0, x | 0), Math.max(0, y2 | 0), Math.max(1, w | 0), Math.max(1, h | 0));
          for (let by = 0; by < tmp.height; by += block * d)
            for (let bx = 0; bx < tmp.width; bx += block * d) {
              const ix = ((by | 0) * tmp.width + (bx | 0)) * 4;
              hx.fillStyle = "rgb(" + tmp.data[ix] + "," + tmp.data[ix + 1] + "," + tmp.data[ix + 2] + ")";
              hx.fillRect(x + bx, y2 + by, block * d, block * d);
            }
        }
        if (r.fx === "scan") { hx.fillStyle = "rgba(0,0,0,.35)"; for (let sy = 0; sy < h; sy += 3 * d) hx.fillRect(x, y2 + sy, w, d); }
        if (r.fx === "glitch" && !reduce && Math.sin(t * 13 + n) > 0.6) { hx.drawImage(hudC, x, y2 + h * 0.3, w, h * 0.2, x + 8 * d, y2 + h * 0.3, w, h * 0.2); }
        hx.strokeStyle = "rgba(237,237,234,.45)"; hx.strokeRect(x, y2, w, h);
      } else if (tl.kind === "dots") {
        hx.fillStyle = r.pal[2];
        for (let dy = 2 * d; dy < h; dy += 4 * d) for (let dx = 2 * d; dx < w; dx += 4 * d) if (rnd(dx * 0.1 + dy * 0.37 + n) > 0.35) hx.fillRect(x + dx, y2 + dy, 1.6 * d, 1.6 * d);
      } else {
        hx.strokeStyle = "rgba(237,237,234,.7)"; hx.strokeRect(x, y2, Math.min(w, 34 * d), Math.min(h, 26 * d));
        hx.font = 10 * d + `px ${MONO}`; hx.fillStyle = "#ededea"; hx.fillText("×", x + Math.min(w, 34 * d) / 2 - 3 * d, y2 + Math.min(h, 26 * d) / 2 + 3 * d);
      }
      hx.globalAlpha = 1;
      if (n % 3 === 0) { hx.font = 9 * d + `px ${SANS}`; hx.fillStyle = "rgba(237,237,234,.9)"; hx.fillText("x: " + Math.round(1200 + tl.u * 1400) + "  y: " + Math.round(700 + tl.v * 800), x, y2 - 3 * d); }
    });
    // title block
    hx.fillStyle = "#ededea"; hx.font = "600 " + 11 * d + `px ${SANS}`; hx.fillText(scramble(r.name.toUpperCase(), age * 1.6), fx, fy - 30 * d);
    hx.font = 9.5 * d + `px ${SANS}`; hx.fillStyle = "#c9c9c5";
    hx.fillText(scramble(r.status + "  ·  " + r.year + "  ·  " + r.note, age * 1.6), fx, fy - 17 * d);
    hx.fillText("w: " + Math.round(fw / d) + "  h: " + Math.round(fh / d), fx, fy - 5 * d);
    hx.fillStyle = "#ff5a1f"; hx.beginPath(); hx.arc(fx + fw * age, fy, 2.5 * d, 0, 7); hx.fill();
  }
}
