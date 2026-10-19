// The Record stage canvas: the control region (or the sim's own wrist box), the hand's bones when
// the hand art isn't drawing it, and the hand dot that drives the arm. Moved out of RecordPage.tsx
// unchanged, so the new /record page draws exactly the same thing; `palette` only recolours it.

import type { TrackedHand } from "../hand/contracts";
import { palmCenter, type TeleopControlSettings } from "./teleop/controlRegion";
import { CALIBRATION, type Framing } from "./framing";
import { lockChipText, type HandLockStatus } from "./teleop/handLock";

// MediaPipe hand skeleton: landmark index pairs.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Colours (and the label font family) for the stage; each one left out reads the old page's CSS token. */
export type StagePalette = Partial<{ line: string; edge: string; label: string; bones: string; joints: string; dot: string; font: string }>;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Mirrored, like a mirror: the user's right hand appears on the right. artDrawing: the hand-art
 *  overlay draws the hand, so the 2D bones (its no-WebGL fallback) are skipped. lock: the hand
 *  lock's status, drawn as a small chip in the top-left corner ("locked: right hand"). */
export function drawStage(
  canvas: HTMLCanvasElement,
  hand: TrackedHand | null,
  framing: Framing,
  settings: TeleopControlSettings,
  gripper: 0 | 1,
  artDrawing: boolean,
  palette: StagePalette = {},
  lock?: HandLockStatus,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);
  ctx.clearRect(0, 0, w, h);
  const x = (u: number) => (1 - u) * w;
  const y = (v: number) => v * h;

  // The control region (or, with it off, the sim's own wrist box). Its bottom edge is table height.
  const r = settings.region;
  const box = settings.enabled
    ? { u0: r.centerX - r.width / 2, u1: r.centerX + r.width / 2, v0: r.centerY - r.height / 2, v1: r.centerY + r.height / 2 }
    : { u0: CALIBRATION.u_min, u1: CALIBRATION.u_max, v0: CALIBRATION.v_min, v1: CALIBRATION.v_max };
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.lineWidth = dpr;
  ctx.strokeStyle = framing.state === "edge" ? palette.edge ?? cssVar("--warm-line") : palette.line ?? cssVar("--border-strong");
  ctx.strokeRect(x(box.u1), y(box.v0), x(box.u0) - x(box.u1), y(box.v1) - y(box.v0));
  ctx.setLineDash([]);
  ctx.fillStyle = palette.label ?? cssVar("--text-muted");
  ctx.font = `${11 * dpr}px ${palette.font ?? "sans-serif"}`;
  ctx.fillText("table", x(box.u1) + 4 * dpr, y(box.v1) - 4 * dpr);
  if (lock) drawLockChip(ctx, lock, dpr, palette);
  if (!hand) return;

  const lm = hand.landmarks;
  if (!artDrawing) {
    ctx.strokeStyle = palette.bones ?? cssVar("--accent");
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(x(lm[a].x), y(lm[a].y));
      ctx.lineTo(x(lm[b].x), y(lm[b].y));
    }
    ctx.stroke();
    ctx.fillStyle = palette.joints ?? cssVar("--text");
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(x(p.x), y(p.y), 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The hand dot: the point that drives the arm (palm center, or the wrist with the region off).
  // Filled while the gripper is closed.
  const dot = settings.enabled ? palmCenter(lm) : lm[0];
  ctx.beginPath();
  ctx.arc(x(dot.x), y(dot.y), 7 * dpr, 0, Math.PI * 2);
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = palette.dot ?? cssVar("--accent");
  ctx.stroke();
  if (gripper) {
    ctx.fillStyle = palette.dot ?? cssVar("--accent");
    ctx.fill();
  }
}

/** The hand lock chip: a small box in the top-left corner; while searching (or lost) a bar under the
 *  text fills as the hand is held still. Solid edge when locked, dashed otherwise. */
function drawLockChip(ctx: CanvasRenderingContext2D, lock: HandLockStatus, dpr: number, palette: StagePalette) {
  const text = lockChipText(lock);
  const pad = 6 * dpr;
  const h = 20 * dpr;
  ctx.font = `${11 * dpr}px ${palette.font ?? "sans-serif"}`;
  const w = ctx.measureText(text).width + 2 * pad;
  const x0 = 8 * dpr;
  const y0 = 8 * dpr;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = dpr;
  ctx.setLineDash(lock.phase === "locked" ? [] : [3 * dpr, 3 * dpr]);
  ctx.strokeStyle = lock.phase === "locked" ? palette.dot ?? cssVar("--accent") : palette.edge ?? cssVar("--warm-line");
  ctx.strokeRect(x0, y0, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x0 + pad, y0 + h - 6 * dpr);
  if (lock.phase === "searching" || lock.phase === "lost") {
    ctx.fillStyle = palette.dot ?? cssVar("--accent");
    ctx.fillRect(x0, y0 + h - 2 * dpr, w * lock.progress, 2 * dpr);
  }
}
