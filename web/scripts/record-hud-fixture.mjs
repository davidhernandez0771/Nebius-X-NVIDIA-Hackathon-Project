// Writes web/src/site/record-hud/fixture/session.json: a 10 s pick-and-place hand path for the
// Record HUD preview (/site/record-hud), in the HandPoseMsg wire format plus the 21 landmarks.
//
// It is scripted, not a webcam recording: keyframes drive a drawn hand, and the wire fields are then
// measured from those landmarks the way web/src/record/teleop/handPoseMessage.ts measures them, so the file
// is shaped exactly like a real session and a real one can replace it. 30 Hz is the rate messages
// arrive at (docs/superpowers/notes/2026-10-15-t4-status.md:169).
//
//   node web/scripts/record-hud-fixture.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../src/site/record-hud/fixture/session.json");
const W = 640;
const H = 480;
const RATE_HZ = 30;
const SECONDS = 10;

// An open right hand as the user sees it (mirrored), wrist at the origin, up is -y.
const BASE = [[0, 0], [-0.25, -0.15], [-0.42, -0.32], [-0.55, -0.5], [-0.65, -0.66], [-0.18, -0.62], [-0.2, -0.88], [-0.21, -1.05],
  [-0.22, -1.2], [0, -0.65], [0, -0.95], [0, -1.13], [0, -1.3], [0.17, -0.6], [0.19, -0.86], [0.2, -1.02], [0.21, -1.15], [0.32, -0.52],
  [0.37, -0.72], [0.4, -0.85], [0.42, -0.97]];
const PALM_UNITS = Math.hypot(BASE[5][0] - BASE[17][0], BASE[5][1] - BASE[17][1]);

// [t s, view u (user's left -> right), v (top -> bottom), pinch 0 open .. 1 closed, palm width / frame_w]
const KEYS = [[0, 0.3, 0.42, 0, 0.095], [2.4, 0.44, 0.4, 0, 0.1], [3.4, 0.44, 0.82, 0, 0.104], [4.3, 0.44, 0.82, 1, 0.104],
  [5.4, 0.44, 0.4, 1, 0.1], [7.0, 0.72, 0.42, 1, 0.112], [7.8, 0.72, 0.78, 1, 0.112], [8.4, 0.72, 0.78, 0, 0.11], [10, 0.3, 0.42, 0, 0.095]];
const PHASES = [[0, "approach"], [2.4, "descend"], [3.4, "grip"], [4.3, "lift"], [5.4, "carry"], [7.0, "lower"], [7.8, "release"], [8.4, "return"]];

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const round = (v, d) => Number(v.toFixed(d));

// mulberry32: the same tremor on every run.
let seed = 20261018;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function sample(t) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const k = ease((t - a[0]) / (b[0] - a[0]));
      return { u: lerp(a[1], b[1], k), v: lerp(a[2], b[2], k), p: lerp(a[3], b[3], k), palm: lerp(a[4], b[4], k) };
    }
  }
  const [, u, v, p, palm] = KEYS[0];
  return { u, v, p, palm };
}

const phaseAt = (t) => PHASES.filter(([at]) => t >= at).pop()[1];

// Landmarks in raw (unmirrored) normalized frame coordinates, like MediaPipe gives them.
function landmarks(s, t) {
  const scale = (s.palm * W) / PALM_UNITS;
  const yaw = 0.08 * Math.sin(t * 0.7);
  const pts = BASE.map(([x, y]) => [x, y]);
  // Pinch: thumb and index tips meet near their midpoint; the joints below them follow part way.
  const mid = [(pts[4][0] + pts[8][0]) / 2, (pts[4][1] + pts[8][1]) / 2];
  for (const [i, k] of [[4, 0.8], [3, 0.4], [8, 0.8], [7, 0.4]]) {
    pts[i] = [lerp(pts[i][0], mid[0], s.p * k), lerp(pts[i][1], mid[1], s.p * k)];
  }
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const wx = (1 - s.u) * W;
  const wy = s.v * H;
  return pts.map(([x, y]) => {
    const rx = x * c - y * sn;
    const ry = x * sn + y * c;
    // Mirror back to the raw frame: the user's right is the camera's left.
    const px = wx - rx * scale + (rand() - 0.5) * 2;
    const py = wy + ry * scale + (rand() - 0.5) * 2;
    return [round(px / W, 3), round(py / H, 3)];
  });
}

const dist = (a, b) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const frames = [];
for (let i = 0; i < RATE_HZ * SECONDS; i++) {
  const t = i / RATE_HZ;
  const lm = landmarks(sample(t), t);
  const palmPx = dist(lm[5], lm[17]);
  frames.push({
    t_ms: round(t * 1000, 1),
    tracking_ok: true,
    wrist_uv: [round(clamp01(lm[0][0]), 5), round(clamp01(lm[0][1]), 5)],
    palm_width: round(palmPx / W, 5),
    pinch_ratio: round(dist(lm[4], lm[8]) / palmPx, 5),
    yaw_rad: round(Math.atan2((lm[9][0] - lm[0][0]) * W, -(lm[9][1] - lm[0][1]) * H), 5),
    frame_w: W,
    frame_h: H,
    phase: phaseAt(t),
    landmarks: lm,
  });
}

const about =
  "Scripted 10 s pick-and-place hand path, not a webcam recording. Wire fields are measured from the drawn landmarks " +
  "as web/src/record/teleop/handPoseMessage.ts measures them. Written by web/scripts/record-hud-fixture.mjs.";
const body = frames.map((f) => "    " + JSON.stringify(f)).join(",\n");
writeFileSync(OUT, `{\n  "about": ${JSON.stringify(about)},\n  "rate_hz": ${RATE_HZ},\n  "frames": [\n${body}\n  ]\n}\n`);
console.log(`wrote ${frames.length} frames to ${OUT}`);
