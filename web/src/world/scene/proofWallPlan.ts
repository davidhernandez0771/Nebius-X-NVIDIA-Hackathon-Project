// The proof wall (proof-wall, 2026-10-26, the user): the story's proof, also a place in the workshop. A large lit
// results board on the room's back wall, left of the spiral, hung on the dark board Blender put there (shelves.glb:
// 12 × 6 m, its glyphs standing proud of it): a dark glass screen in a teal holo frame that shows, from the room
// view, "0/40 → 30/40" and the climb's four bars against the goal, so it reads as a landmark. A click (or its hub
// tag, "05 The proof") opens the place (stations/proof), where the four figures step through as panels laid over the
// screen, which then shows only its glass and frame.
//
// Cheap on purpose: two meshes (the screen and the light it spills on the wall), two triangles each, one 1024×512
// canvas drawn once (again when the real font arrives) and a 128×64 one for the spill. Both are plain
// MeshBasicMaterials, so the room's materialize patches them (Materialize.tsx) and its lamps light them (power.ts).
// Every number on the face is from proofData. Pure apart from the canvas; the layout and the face are tested.
import * as THREE from "three";
import type { Vec3 } from "../core/types";
import { CLIMB, CLIMB_FOOTNOTE_SHORT, GOAL, LEAD } from "../../site/results/proofData";

/**
 * The board it hangs on: the left of the back wall's two dark boards in shelves.glb (measured from its vertices),
 * x −17 to −5 and y 3.9 to 9.9; its face at z −20.66 and its raised glyphs reaching z −20.48. The right one is behind
 * the shelf's tag and the machine's; the back wall is at z −20.8.
 */
export const PROOF_BOARD = { x: [-17, -5] as const, y: [3.9, 9.9] as const, front: -20.66, glyphs: -20.48 };

/** The screen: centred on the board, a 0.4 m bezel at the sides and 0.2 m over and under, just proud of the glyphs. */
export const PROOF_WALL = {
  center: [-11, 6.9, -20.42] as Vec3,
  width: 11.2,
  height: 5.6,
  /** It faces the room (+z). */
  normal: [0, 0, 1] as Vec3,
};

/** The face's canvas, in pixels: 2:1 like the screen. */
export const PROOF_TEX = { w: 1024, h: 512 } as const;

/** The spill: this much bigger than the screen, on the board just behind it. */
const SPILL = { w: 1.24, h: 1.4, canvas: [128, 64] as const, opacity: 0.55 };

const V2 = CLIMB[CLIMB.length - 1];

export interface ProofFace {
  kicker: string;
  /** "0/40 → 30/40": the climb's first and last step. */
  head: string;
  from: string;
  to: string;
  /** The Results page's lead line. */
  line: string;
  rows: { tag: string; k: number; n: number; ci: readonly [number, number]; hi: boolean }[];
  goal: { k: number; n: number };
  foot: string;
}

/** What the face says, all from proofData. */
export function proofFace(): ProofFace {
  const from = `${CLIMB[0].k}/${CLIMB[0].n}`;
  const to = `${V2.k}/${V2.n}`;
  return {
    kicker: "05 / The proof · pre-registered, run once",
    head: `${from} → ${to}`,
    from,
    to,
    line: LEAD.headline,
    rows: CLIMB.map((s) => ({ tag: s.tag, k: s.k, n: s.n, ci: s.ci, hi: s.key === V2.key })),
    goal: { k: GOAL.k, n: GOAL.n },
    foot: CLIMB_FOOTNOTE_SHORT,
  };
}

// ---------------------------------------------------------------- the face's layout (canvas px)

const PAD = 56;
/**
 * From the room view the spiral hides the screen's right third (x > −9.2 m, 62% across): the headline and the climb
 * sit in the left 60%, and the right-hand column (what is inside) is read on the way in.
 */
const L = {
  kicker: { y: 72, px: 20 },
  head: { y: 172, px: 78 },
  line: { y: 214, px: 17 },
  /** The climb: four rows, a track from x0 to x1, the counts after it. */
  graph: { top: 246, row0: 286, pitch: 40, x0: 140, x1: 496, count: 514, px: 20, bottom: 452 },
  axis: { y: 444, px: 13 },
  foot: { y: 486, px: 13 },
  /** The right-hand column. */
  side: { x: 700, y: 118, px: 15 },
} as const;
/** Geist Mono advances 0.6 em a letter. */
const ADVANCE = 0.6;

const INK = "#e6f4f0";
const INK_2 = "#a9c9c1";
const DIM = "#6f8a84";
const TEAL = "#19f5c2";
const CONTEXT = "#6b7f7a";
const FONT = '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace';

const trackX = (share: number) => L.graph.x0 + (L.graph.x1 - L.graph.x0) * share;
const rowY = (i: number) => L.graph.row0 + i * L.graph.pitch;

/** Canvas px on the face → the world point on the screen. */
function onScreen(u: number, v: number): THREE.Vector3 {
  const [cx, cy, cz] = PROOF_WALL.center;
  return new THREE.Vector3(cx - PROOF_WALL.width / 2 + (u / PROOF_TEX.w) * PROOF_WALL.width, cy + PROOF_WALL.height / 2 - (v / PROOF_TEX.h) * PROOF_WALL.height, cz);
}

/** The screen's corners (world): top left, top right, bottom right, bottom left. */
export function wallCorners(): THREE.Vector3[] {
  return [onScreen(0, 0), onScreen(PROOF_TEX.w, 0), onScreen(PROOF_TEX.w, PROOF_TEX.h), onScreen(0, PROOF_TEX.h)];
}

/** Where on the screen (world corners) the headline and the climb are drawn, for the room view's checks. */
export function faceRegion(part: "head" | "graph"): THREE.Vector3[] {
  const f = proofFace();
  if (part === "head") {
    const w = f.head.length * L.head.px * ADVANCE;
    const top = L.head.y - L.head.px * 0.74;
    return [onScreen(PAD, top), onScreen(PAD + w, top), onScreen(PAD + w, L.head.y + 4), onScreen(PAD, L.head.y + 4)];
  }
  const right = L.graph.count + `${V2.k}/${V2.n}`.length * L.graph.px * ADVANCE;
  return [onScreen(PAD, L.graph.top), onScreen(right, L.graph.top), onScreen(right, L.graph.bottom), onScreen(PAD, L.graph.bottom)];
}

// ---------------------------------------------------------------- drawing

/**
 * Paints the face: dark glass, the holo frame, the headline and the climb. `blank`: the glass and the frame only,
 * while the place is open and its panels lie over the screen as its content.
 */
export function drawFace(g: CanvasRenderingContext2D, f: ProofFace, panels: readonly string[] = [], blank = false): void {
  const { w, h } = PROOF_TEX;
  const spaced = (n: number) => ((g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${n}px`);
  const text = (s: string, x: number, y: number, px: number, weight: number, color: string, track = 0) => {
    g.font = `${weight} ${px}px ${FONT}`;
    spaced(track);
    g.fillStyle = color;
    g.fillText(s, x, y);
    return g.measureText(s).width;
  };

  // The glass: near black, a touch lighter at the top, faint scan lines.
  const glass = g.createLinearGradient(0, 0, 0, h);
  glass.addColorStop(0, "#071312");
  glass.addColorStop(1, "#030708");
  g.fillStyle = glass;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(25, 245, 194, 0.025)";
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);

  // The holo frame: a hairline, and brighter corner brackets.
  g.strokeStyle = "rgba(25, 245, 194, 0.28)";
  g.lineWidth = 2;
  g.strokeRect(16, 16, w - 32, h - 32);
  g.strokeStyle = TEAL;
  g.lineWidth = 4;
  const arm = 34;
  for (const [x, y, dx, dy] of [
    [16, 16, 1, 1],
    [w - 16, 16, -1, 1],
    [w - 16, h - 16, -1, -1],
    [16, h - 16, 1, -1],
  ] as const) {
    g.beginPath();
    g.moveTo(x, y + dy * arm);
    g.lineTo(x, y);
    g.lineTo(x + dx * arm, y);
    g.stroke();
  }

  if (blank) return;
  g.textBaseline = "alphabetic";
  text(f.kicker.toUpperCase(), PAD, L.kicker.y, L.kicker.px, 500, TEAL, 2);

  // The headline: where it started, and where it got to (teal, the one result that matters).
  const a = text(`${f.from} → `, PAD, L.head.y, L.head.px, 300, INK, -2);
  g.save();
  g.shadowColor = "rgba(25, 245, 194, 0.55)";
  g.shadowBlur = 24;
  text(f.to, PAD + a, L.head.y, L.head.px, 300, TEAL, -2);
  g.restore();
  text(f.line.toUpperCase(), PAD, L.line.y, L.line.px, 400, INK_2, 1);

  // The climb: a track per step, its bar, its Wilson whisker, its count; the goal dashed across.
  const goalX = trackX(f.goal.k / f.goal.n);
  f.rows.forEach((r, i) => {
    const y = rowY(i);
    text(r.tag.toUpperCase(), PAD, y + 6, 17, 600, r.hi ? TEAL : INK, 2);
    g.fillStyle = "rgba(216, 239, 233, 0.07)";
    g.fillRect(L.graph.x0, y - 7, L.graph.x1 - L.graph.x0, 14);
    g.fillStyle = r.hi ? TEAL : CONTEXT;
    g.fillRect(L.graph.x0, y - 7, (L.graph.x1 - L.graph.x0) * (r.k / r.n), 14);
    g.strokeStyle = "rgba(234, 247, 243, 0.85)";
    g.lineWidth = 2;
    const [lo, hi] = [trackX(r.ci[0]), trackX(r.ci[1])];
    g.beginPath();
    g.moveTo(lo, y);
    g.lineTo(hi, y);
    g.moveTo(lo, y - 6);
    g.lineTo(lo, y + 6);
    g.moveTo(hi, y - 6);
    g.lineTo(hi, y + 6);
    g.stroke();
    text(`${r.k}/${r.n}`, L.graph.count, y + 7, L.graph.px, 500, r.hi ? TEAL : INK);
  });
  g.save();
  g.strokeStyle = "rgba(234, 247, 243, 0.75)";
  g.lineWidth = 2;
  g.setLineDash([7, 6]);
  g.beginPath();
  g.moveTo(goalX, L.graph.top + 8);
  g.lineTo(goalX, rowY(f.rows.length - 1) + 14);
  g.stroke();
  g.restore();
  text(`GOAL ${Math.round((100 * f.goal.k) / f.goal.n)}% · ${f.goal.k}/${f.goal.n}`, goalX + 8, L.graph.top + 12, 14, 500, INK, 1);
  [0, 0.5, 1].forEach((t) => {
    const label = `${t * 100}%`;
    const x = trackX(t) - (t === 0 ? 0 : t === 1 ? label.length * L.axis.px * ADVANCE : (label.length * L.axis.px * ADVANCE) / 2);
    text(label, x, L.axis.y, L.axis.px, 400, DIM);
  });
  text(f.foot.toUpperCase(), PAD, L.foot.y, L.foot.px, 400, DIM, 1);

  // The right-hand column (behind the spiral from the room view): what is inside, for the way in.
  if (panels.length) {
    g.fillStyle = "rgba(25, 245, 194, 0.2)";
    g.fillRect(L.side.x - 28, L.side.y - 30, 2, 26 * panels.length + 70);
    text("INSIDE", L.side.x, L.side.y, L.side.px, 600, TEAL, 2);
    panels.forEach((p, i) => text(`${i + 1}  ${p.toUpperCase()}`, L.side.x, L.side.y + 34 + i * 28, L.side.px, 400, INK_2, 1));
    text("CLICK TO STEP THROUGH →", L.side.x, L.side.y + 34 + panels.length * 28 + 18, 13, 500, TEAL, 1);
  }
}

/** The spill: a soft glow, brightest round the screen's edge, fading out over the board and the wall. */
function drawSpill(g: CanvasRenderingContext2D): void {
  const [w, h] = SPILL.canvas;
  g.clearRect(0, 0, w, h);
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(120, 235, 210, 0.9)");
  r.addColorStop(0.55, "rgba(70, 200, 175, 0.45)");
  r.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.save();
  // Stretched to an ellipse as wide as the canvas.
  g.translate(0, h / 2);
  g.scale(1, h / w);
  g.translate(0, -w / 2);
  g.fillStyle = r;
  g.fillRect(0, 0, w, w);
  g.restore();
}

// ---------------------------------------------------------------- the meshes

export interface ProofWallParts {
  group: THREE.Group;
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  map: THREE.CanvasTexture;
  /** Paints the face again (the real font has arrived); false without a 2D context. */
  redraw: () => boolean;
  /** Blank glass in the frame (the place is open, its panels are the content), or the face again. */
  setBlank: (blank: boolean) => boolean;
  dispose: () => void;
}

/** Builds the wall: the screen (its face drawn) and its spill, in world coordinates. */
export function makeProofWall(panels: readonly string[] = []): ProofWallParts {
  const canvas = document.createElement("canvas");
  canvas.width = PROOF_TEX.w;
  canvas.height = PROOF_TEX.h;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const face = proofFace();
  let blank = false;
  const redraw = () => {
    const g = canvas.getContext("2d");
    if (!g) return false;
    drawFace(g, face, panels, blank);
    map.needsUpdate = true;
    return true;
  };
  redraw();
  const setBlank = (b: boolean) => {
    if (b === blank) return false;
    blank = b;
    return redraw();
  };

  const [cx, cy, cz] = PROOF_WALL.center;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(PROOF_WALL.width, PROOF_WALL.height), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  screen.position.set(cx, cy, cz);
  screen.name = "proof-wall:screen";

  const spillCanvas = document.createElement("canvas");
  [spillCanvas.width, spillCanvas.height] = SPILL.canvas;
  const sg = spillCanvas.getContext("2d");
  if (sg) drawSpill(sg);
  const spillMap = new THREE.CanvasTexture(spillCanvas);
  spillMap.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(PROOF_WALL.width * SPILL.w, PROOF_WALL.height * SPILL.h),
    new THREE.MeshBasicMaterial({ map: spillMap, transparent: true, opacity: SPILL.opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  // On the board, under the screen and its glyphs: it lights the bezel and the wall round it.
  halo.position.set(cx, cy, PROOF_BOARD.front + 0.03);
  halo.raycast = () => {};
  halo.renderOrder = 1;
  halo.name = "proof-wall:spill";

  const group = new THREE.Group();
  group.name = "proof-wall";
  group.add(halo, screen);
  return {
    group,
    screen,
    halo,
    map,
    redraw,
    setBlank,
    dispose() {
      screen.geometry.dispose();
      screen.material.dispose();
      halo.geometry.dispose();
      halo.material.dispose();
      map.dispose();
      spillMap.dispose();
    },
  };
}
