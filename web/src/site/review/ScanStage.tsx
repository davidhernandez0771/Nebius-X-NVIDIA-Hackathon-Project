// The scan: the demo in a thin frame, an amber scan band sweeping its clock, detection boxes that lock
// on to the cube while the playhead is inside an issue, then a mosaic/glitch morph into the perfected
// demo (teal). Around it, evidence tiles (the frame at each issue) resolve from mosaic, after the
// robot-shelf HUD. With no camera frames (a live demo), the frame shows the end-effector path instead.

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Demo } from "../../pm/types";
import { durationOf, type FrameSheet, type Subject } from "./data";
import { activeIssues, detectionTag, formatSpan, isWholeDemo, morphAt, scramble, type IssueRow } from "./model";
import type { PlayState } from "./playback";
import { TONES, xraySheet, type Box, type XrayFrame } from "./xray";

const INK = "rgba(230,237,243,";
const AMBER = "#FFB000";
const TEAL = "#19F5C2";
const VOID = "#07090C";
const UI = '"Geist", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Consolas, monospace';

type Side = "raw" | "perfected";

interface Props {
  subject: Subject;
  rows: IssueRow[];
  play: MutableRefObject<PlayState>;
  reduced: boolean;
}

function rnd(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function useSheet(sheet: FrameSheet | null, side: Side) {
  const frames = useRef<XrayFrame[] | null>(null);
  useEffect(() => {
    frames.current = null;
    if (!sheet) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live) frames.current = xraySheet(img, sheet, TONES[side]);
    };
    img.src = sheet.url;
    return () => {
      live = false;
    };
  }, [sheet, side]);
  return frames;
}

function frameIndex(sheet: FrameSheet, t: number) {
  let k = 0;
  while (k + 1 < sheet.steps.length && sheet.steps[k + 1] / sheet.fps <= t + 1e-6) k++;
  return k;
}

function sampleAt(demo: Demo, t: number) {
  const tr = demo.trajectory;
  let k = 0;
  while (k + 1 < tr.t.length && tr.t[k + 1] <= t) k++;
  return { pos: tr.ee_pos[k], gripper: tr.gripper[k], k };
}

/** A front view of the end-effector path, for demos without camera frames. */
function pathProjector(demos: Demo[], x: number, y: number, size: number) {
  const pts = demos.flatMap((d) => d.trajectory.ee_pos).concat(demos.map((d) => d.scene.cube_pose.pos), demos.map((d) => d.scene.bin_pose.pos));
  const sx = (p: number[]) => -p[1];
  const sy = (p: number[]) => -(p[2] + 0.35 * p[0]);
  const xs = pts.map(sx);
  const ys = pts.map(sy);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const pad = size * 0.12;
  const k = (size - 2 * pad) / span;
  return (p: number[]) => [x + pad + (sx(p) - x0) * k + ((size - 2 * pad) - (x1 - x0) * k) / 2, y + pad + (sy(p) - y0) * k + ((size - 2 * pad) - (y1 - y0) * k) / 2];
}

export default function ScanStage({ subject, rows, play, reduced }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rawFrames = useSheet(subject.raw.frames, "raw");
  const perfFrames = useSheet(subject.perfected?.frames ?? null, "perfected");
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const g = el?.getContext("2d");
    if (!el || !box || !g) return;
    const born = performance.now();
    const rawDur = durationOf(subject.raw.demo);
    const perfDur = subject.perfected ? durationOf(subject.perfected.demo) : null;
    const tmp = document.createElement("canvas");
    const tx = tmp.getContext("2d");
    let W = 0;
    let H = 0;
    let dpr = 1;
    const lastCube: Record<Side, Box | null> = { raw: null, perfected: null };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth;
      H = box.clientHeight;
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    // Evidence tiles: the raw frame in the middle of each timed issue, the first raw frame and the last perfected one.
    type Tile = { side: Side; t: number; tag: string; when: string; seed: number };
    const tiles: Tile[] = [{ side: "raw", t: 0, tag: "RAW", when: "0.00 s", seed: 1 }];
    rows.forEach((r) => {
      if (r.kind !== "issue" || isWholeDemo(r, rawDur) || r.t0 == null || r.t1 == null) return;
      tiles.push({ side: "raw", t: (r.t0 + r.t1) / 2, tag: detectionTag(r), when: formatSpan(r), seed: r.index + 2 });
    });
    if (subject.perfected && perfDur != null) tiles.push({ side: "perfected", t: perfDur, tag: "PERFECTED", when: `${perfDur.toFixed(2)} s`, seed: 40 });

    const frameOf = (side: Side, t: number): XrayFrame | null => {
      const sheet = side === "raw" ? subject.raw.frames : subject.perfected?.frames;
      const frames = side === "raw" ? rawFrames.current : perfFrames.current;
      if (!sheet || !frames || !frames.length) return null;
      return frames[Math.min(frames.length - 1, frameIndex(sheet, t))];
    };

    const mosaic = (src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, block: number) => {
      if (block <= 1 || !tx) {
        g.imageSmoothingEnabled = true;
        g.drawImage(src, x, y, w, h);
        return;
      }
      tmp.width = Math.max(1, Math.round(sw / block));
      tmp.height = Math.max(1, Math.round(sh / block));
      tx.imageSmoothingEnabled = true;
      tx.drawImage(src, 0, 0, tmp.width, tmp.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(tmp, x, y, w, h);
    };

    const label = (text: string, x: number, y: number, color: string, font = `500 ${10}px ${MONO}`) => {
      g.font = font;
      const w = g.measureText(text).width + 8;
      g.fillStyle = color;
      g.fillRect(x, y - 13, w, 15);
      g.fillStyle = VOID;
      g.fillText(text, x + 4, y - 2);
      return w;
    };

    const drawPath = (side: Side, t: number, x: number, y: number, size: number, alpha: number) => {
      const demos = [subject.raw.demo, ...(subject.perfected ? [subject.perfected.demo] : [])];
      const proj = pathProjector(demos, x, y, size);
      const demo = side === "raw" ? subject.raw.demo : subject.perfected!.demo;
      const color = side === "raw" ? AMBER : TEAL;
      g.globalAlpha = alpha;
      // the floor grid, for depth
      g.strokeStyle = `${INK}.08)`;
      for (let k = 1; k < 8; k++) {
        g.beginPath();
        g.moveTo(x, y + (size * k) / 8);
        g.lineTo(x + size, y + (size * k) / 8);
        g.stroke();
      }
      const sc = demo.scene;
      for (const [p, c] of [
        [sc.bin_pose.pos, `${INK}.35)`],
        [sc.cube_pose.pos, color],
      ] as const) {
        const [px, py] = proj(p);
        g.strokeStyle = c;
        g.strokeRect(px - 7, py - 7, 14, 14);
      }
      const tr = demo.trajectory;
      const cur = sampleAt(demo, t);
      g.lineWidth = 1;
      g.strokeStyle = `${INK}.22)`;
      g.beginPath();
      tr.ee_pos.forEach((p, k) => {
        const [px, py] = proj(p);
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.stroke();
      g.lineWidth = 2;
      for (let k = 1; k <= cur.k; k++) {
        const [ax, ay] = proj(tr.ee_pos[k - 1]);
        const [bx, by] = proj(tr.ee_pos[k]);
        g.strokeStyle = tr.gripper[k] ? color : `${INK}.9)`;
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      g.lineWidth = 1;
      const [hx, hy] = proj(cur.pos);
      g.fillStyle = color;
      g.beginPath();
      g.arc(hx, hy, 3.5, 0, 7);
      g.fill();
      g.globalAlpha = 1;
      return { x0: hx - 16, y0: hy - 16, x1: hx + 16, y1: hy + 16 };
    };

    const draw = (now: number) => {
      const s = play.current;
      const red = reducedRef.current;
      const secs = Math.max(0, (now - born) / 1000);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = VOID;
      g.fillRect(0, 0, W, H);
      const wide = W >= 760;
      const F = Math.max(40, wide ? Math.min(H - 110, W * 0.44) : Math.min(W - 32, H - 120));
      const fx = wide ? Math.max(24, W * 0.07) : (W - F) / 2;
      const fy = wide ? 78 : 70;
      const side: Side = s.mode === "perfected" || (s.mode === "morph" && morphAt(s.morph).showAfter) ? "perfected" : "raw";
      const dur = side === "raw" ? rawDur : (perfDur ?? 0);
      const t = s.mode === "morph" ? (morphAt(s.morph).showAfter ? 0 : rawDur) : s.t;
      const color = side === "raw" ? AMBER : TEAL;
      const intro = red ? 1 : Math.min(1, secs / 1.1);
      const hasFrames = !!subject.raw.frames;

      // one tilted orbit with two travelling dots, behind the frame (the shelf HUD's signature, kept quiet)
      g.save();
      g.translate(fx + F / 2, fy + F / 2);
      g.rotate(-0.32 + (red ? 0 : secs * 0.02));
      g.setLineDash([2, 6]);
      g.strokeStyle = `${INK}${0.16 * intro})`;
      g.beginPath();
      g.ellipse(0, 0, F * 0.74 * intro, F * 0.34 * intro, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      for (let k = 0; k < 2; k++) {
        const a = red ? k * 3 : secs * 0.35 + k * 3.1;
        g.fillStyle = `${INK}.7)`;
        g.beginPath();
        g.arc(Math.cos(a) * F * 0.74 * intro, Math.sin(a) * F * 0.34 * intro, 2, 0, 7);
        g.fill();
      }
      g.restore();

      // the frame's content
      const m = s.mode === "morph" ? morphAt(s.morph) : { block: 1, glitch: 0, showAfter: side === "perfected" };
      let cube: Box | null = null;
      const fr = frameOf(side, t);
      if (hasFrames && fr) {
        mosaic(fr.canvas, fr.canvas.width, fr.canvas.height, fx, fy, F, F, red ? 1 : m.block);
        const k = F / fr.canvas.width;
        if (fr.cube) lastCube[side] = fr.cube;
        const c = fr.cube ?? lastCube[side];
        if (c) cube = { x0: fx + c.x0 * k, y0: fy + c.y0 * k, x1: fx + (c.x1 + 1) * k, y1: fy + (c.y1 + 1) * k };
        // scanlines
        g.fillStyle = "rgba(0,0,0,.28)";
        for (let y = fy; y < fy + F; y += 3) g.fillRect(fx, y, F, 1);
      } else if (!hasFrames) {
        cube = drawPath(side, t, fx, fy, F, s.mode === "morph" ? 1 - m.glitch * 0.7 : 1);
      }
      if (!red && m.glitch > 0) {
        // glitch slices: bands of the frame shifted sideways, strongest mid-morph
        for (let k = 0; k < 7; k++) {
          const sy = fy + rnd(Math.floor(secs * 24) + k) * F;
          const sh = 4 + rnd(k + secs) * 18;
          const dx = (rnd(k * 3.7 + Math.floor(secs * 30)) - 0.5) * 36 * m.glitch;
          g.drawImage(el, fx * dpr, sy * dpr, F * dpr, sh * dpr, fx + dx, sy, F, sh);
        }
        g.fillStyle = `rgba(25,245,194,${0.12 * m.glitch})`;
        g.fillRect(fx, fy, F, F);
      }

      // the scan band, at the playhead
      if (dur > 0) {
        const sx = fx + Math.min(1, t / dur) * F;
        const grad = g.createLinearGradient(sx - 34, 0, sx, 0);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, side === "raw" ? "rgba(255,176,0,.22)" : "rgba(25,245,194,.22)");
        g.fillStyle = grad;
        g.fillRect(sx - 34, fy, 34, F);
        g.fillStyle = color;
        g.fillRect(sx, fy, 1, F);
      }

      // frame, corner ticks, the dot that rides the frame's edge
      g.strokeStyle = `${INK}.6)`;
      g.strokeRect(fx + 0.5, fy + 0.5, F * intro, F);
      g.fillStyle = color;
      g.beginPath();
      g.arc(fx + F * intro, fy, 2.5, 0, 7);
      g.fill();

      // title block
      const demo = side === "raw" ? subject.raw.demo : subject.perfected!.demo;
      const settle = red ? 1 : s.mode === "morph" ? Math.abs(s.morph - 0.5) * 2 : Math.min(1, secs * 1.4);
      g.fillStyle = "#E6EDF3";
      g.font = `600 12px ${UI}`;
      g.fillText(scramble(demo.id.toUpperCase(), settle), fx, fy - 40);
      g.font = `11px ${UI}`;
      g.fillStyle = "#AEB8C3";
      const kind = side === "raw" ? (demo.source === "human" ? "raw demo" : `${demo.source} demo`) : "perfected";
      g.fillText(scramble(`${kind}  ·  ${dur.toFixed(2)} s  ·  ${demo.scene.robot}  ·  seed ${demo.scene.seed}`, settle), fx, fy - 25);
      g.fillStyle = "#8B95A1";
      g.font = `10px ${MONO}`;
      const src = hasFrames ? `front camera  ·  ${subject.raw.frames!.w}×${subject.raw.frames!.h}  ·  a frame every ${(10 / subject.raw.frames!.fps).toFixed(1)} s` : "end-effector path  ·  front view  ·  no camera frames served";
      g.fillText(src, fx, fy - 11);

      // clock, bottom right inside the frame
      const clock = s.mode === "morph" ? scramble(`${(m.showAfter ? perfDur ?? 0 : rawDur).toFixed(2)} s`, settle) : `t ${t.toFixed(2)} / ${dur.toFixed(2)} s`;
      g.font = `500 11px ${MONO}`;
      const cw = g.measureText(clock).width;
      g.fillStyle = "rgba(7,9,12,.75)";
      g.fillRect(fx + F - cw - 14, fy + F - 22, cw + 10, 16);
      g.fillStyle = "#E6EDF3";
      g.fillText(clock, fx + F - cw - 9, fy + F - 10);

      // detection boxes
      if (s.mode !== "morph" && cube) {
        const pad = 10;
        const bx = Math.max(fx + 2, cube.x0 - pad);
        const by = Math.max(fy + 18, cube.y0 - pad);
        const bw = Math.max(40, cube.x1 - cube.x0 + 2 * pad);
        const bh = Math.max(40, cube.y1 - cube.y0 + 2 * pad);
        const here = side === "raw" ? activeIssues(rows, t, rawDur) : [];
        const verified = side === "perfected" && subject.perfected?.verification?.success && perfDur != null && t >= perfDur - 1.2;
        const tags = verified ? [{ tag: "IN BIN  ·  VERIFIED", when: "physics replay" }] : here.map((r) => ({ tag: detectionTag(r), when: formatSpan(r) }));
        if (tags.length) {
          const c = verified ? TEAL : AMBER;
          g.strokeStyle = c;
          g.strokeRect(bx + 0.5, by + 0.5, bw, bh);
          // crosshair "×" box at the corner
          g.strokeStyle = `${INK}.7)`;
          g.strokeRect(bx + bw + 6.5, by + 0.5, 18, 14);
          g.font = `10px ${MONO}`;
          g.fillStyle = "#E6EDF3";
          g.fillText("×", bx + bw + 12, by + 11);
          tags.forEach((tg, k) => {
            const y = by - 4 - k * 30;
            label(tg.tag, bx, y, c);
            g.fillStyle = "#E6EDF3";
            g.font = `10px ${MONO}`;
            g.fillText(tg.when, bx, y + 12 > by ? y - 17 : y + 12);
          });
          const p = sampleAt(demo, t).pos;
          g.fillStyle = "#C9D1D9";
          g.font = `10px ${UI}`;
          g.fillText(`x: ${p[0].toFixed(3)}  y: ${p[1].toFixed(3)}  z: ${p[2].toFixed(3)} m`, bx, by + bh + 14);
        }
      }
      // whole-demo issues get a quiet corner tag while the raw demo shows
      if (side === "raw" && s.mode === "raw") {
        let y = fy + F - 10;
        rows
          .filter((r) => r.kind === "issue" && isWholeDemo(r, rawDur))
          .forEach((r) => {
            label(`${detectionTag(r)}  ·  whole demo`, fx + 8, y, AMBER);
            y -= 19;
          });
      }

      // evidence tiles that resolve from mosaic (wide screens with camera frames)
      if (wide && hasFrames) {
        const rx = fx + F + 56;
        const rw = W - rx - 24;
        const cols = Math.max(2, Math.min(3, Math.floor(rw / 170)));
        const rowsN = Math.ceil(tiles.length / cols);
        const cellW = rw / cols;
        const cellH = (F + 10) / Math.max(rowsN, 2);
        tiles.forEach((tl, n) => {
          const f = frameOf(tl.side, tl.t);
          if (!f) return;
          const a = red ? 1 : Math.max(0, Math.min(1, (secs - 0.35 - n * 0.18) / 0.55));
          if (a <= 0) return;
          const size = Math.min(cellW - 12, cellH - 34) * (0.78 + rnd(tl.seed) * 0.2);
          const x = rx + (n % cols) * cellW + rnd(tl.seed + 0.3) * (cellW - size);
          const y = fy + 18 + Math.floor(n / cols) * cellH + rnd(tl.seed + 0.7) * Math.max(0, cellH - size - 34);
          const flick = red ? 1 : Math.sin(secs * 9 + n * 2.3) > 0.96 ? 0.4 : 1;
          g.globalAlpha = a * flick;
          mosaic(f.canvas, f.canvas.width, f.canvas.height, x, y, size, size, Math.round(12 * Math.pow(1 - a, 1.5)) + 1);
          g.fillStyle = "rgba(0,0,0,.3)";
          for (let yy = y; yy < y + size; yy += 3) g.fillRect(x, yy, size, 1);
          g.globalAlpha = 1;
          g.strokeStyle = `${INK}.45)`;
          g.strokeRect(x + 0.5, y + 0.5, size, size);
          g.font = `10px ${UI}`;
          g.fillStyle = tl.side === "raw" && n > 0 ? AMBER : tl.side === "perfected" ? TEAL : "#C9D1D9";
          g.fillText(tl.tag, x, y - 5);
          g.fillStyle = "#8B95A1";
          g.font = `10px ${MONO}`;
          g.fillText(tl.when, x, y + size + 13);
        });
      }
    };

    let raf = 0;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [subject, rows, play, rawFrames, perfFrames]);

  return (
    <div className="rv2-stage" ref={wrap}>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
