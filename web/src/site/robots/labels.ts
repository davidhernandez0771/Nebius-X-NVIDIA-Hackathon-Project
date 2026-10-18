// The paper label on each cartridge (front, and a dimmer copy under the shell), drawn once into a canvas.
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Robot } from "./robots";
import { HEAVY, MONO } from "./fonts";

/** Draws the label for a robot, or for one of its verified copies when copyN > 0. */
export function drawLabel(g: CanvasRenderingContext2D, w: number, h: number, r: Robot, copyN: number, total: number) {
  g.fillStyle = copyN ? "#d4d4cf" : "#f4f4f0"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#111"; g.fillRect(0, 0, w, 58);
  g.fillStyle = "#f4f4f0"; g.font = `700 30px ${HEAVY}`; g.fillText("SANT", 22, 40);
  g.font = `500 15px ${MONO}`; g.fillText(copyN ? "VERIFIED COPY" : "ROBOT DATA CARTRIDGE", w - 250, 37);
  g.fillStyle = "#111"; g.font = `700 ${r.code.length > 6 ? 88 : 106}px ${HEAVY}`; g.fillText(r.code, 22, 175);
  g.font = `500 18px ${MONO}`; g.fillText(r.sub, 24, 214);
  for (let i = 0; i < 10; i++) g.fillRect(24 + i * 22, 244, 12, i % 3 ? 6 : 12);
  g.lineWidth = 7; g.strokeStyle = "#111";
  g.beginPath(); g.arc(470, 400, 58, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(470, 400, 18, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    g.beginPath(); g.moveTo(470 + Math.cos(a) * 24, 400 + Math.sin(a) * 24); g.lineTo(470 + Math.cos(a) * 50, 400 + Math.sin(a) * 50); g.stroke();
  }
  g.font = `500 16px ${MONO}`;
  g.fillText(copyN ? "#" + String(copyN).padStart(3, "0") + " / " + total : r.status.toUpperCase(), 24, 470);
}

export function labelTexture(r: Robot, copyN: number, total: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 512;
  const g = c.getContext("2d");
  if (g) drawLabel(g, c.width, c.height, r, copyN, total);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
