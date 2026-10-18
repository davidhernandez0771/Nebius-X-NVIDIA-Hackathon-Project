// The landing hero (sprint 9 T5): our take on "big things move slowly, small things move fast". A
// heavy ink hand, built from the 21 hand-tracking landmarks, drifts and pinches slowly; a swarm of
// small robot grippers copies each pinch a beat later and doubles on every one, from one copy to many,
// on a lattice that fans out ahead of the pinch. Reduced motion or Effects off: one still frame with
// the swarm grown.
import { useEffect, useRef, type RefObject } from "react";
import { useMotion } from "../../../sant/motion/MotionProvider";
import { HAND_BONES, handPose, palmOutline, type Pt } from "./handPose";
import { buildSlots, parentOf, pinchCycle, population, springStep, CYCLE, type Body, type Slot } from "./swarm";

const OPEN_LEVELS = 6;
const BLUR_LEVELS = [0, 1.2, 2.6, 4.2];
const FLASH_MS = 700;

type Layout = {
  w: number;
  h: number;
  dpr: number;
  wrist: Pt;
  scale: number;
  angle: number;
  spacing: number;
  cap: number;
  slots: Slot[];
  glyph: number;
};

function layoutFor(w: number, h: number): Layout {
  const narrow = w < 720;
  const scale = narrow ? Math.min(w * 0.26, 120) : Math.min(w * 0.15, h * 0.34, 250);
  const spacing = narrow ? 15 : Math.max(19, Math.min(28, w * 0.018));
  const cap = narrow ? 64 : w > 1200 ? 256 : 128;
  return {
    w,
    h,
    dpr: Math.min(2, window.devicePixelRatio || 1),
    wrist: { x: w * (narrow ? 1 : 0.9), y: h * (narrow ? 0.76 : 0.62) },
    scale,
    // On a phone the text fills the top, so the swarm fans up-left into the space under it.
    angle: narrow ? Math.PI + 0.32 : Math.PI - 0.06,
    spacing,
    cap,
    slots: buildSlots(cap, { spacing, spread: 0.36 }),
    glyph: Math.round(spacing * 0.78),
  };
}

/** A small open gripper pointing along +x: a stem, a palm bar and two jaws `open` (0–1) apart. */
function drawGripper(ctx: CanvasRenderingContext2D, size: number, open: number) {
  const half = size / 2;
  const jaw = half * (0.28 + 0.5 * open);
  ctx.beginPath();
  ctx.moveTo(-half * 0.9, 0);
  ctx.lineTo(-half * 0.15, 0);
  ctx.moveTo(-half * 0.15, -jaw);
  ctx.lineTo(-half * 0.15, jaw);
  ctx.moveTo(-half * 0.15, -jaw);
  ctx.lineTo(half * 0.85, -jaw * 0.82);
  ctx.moveTo(-half * 0.15, jaw);
  ctx.lineTo(half * 0.85, jaw * 0.82);
  ctx.stroke();
}

/** Pre-drawn gripper sprites: [colour][blur][openness]. Blur on a canvas per frame is too slow. */
function makeSprites(glyph: number, dpr: number, colours: string[]): HTMLCanvasElement[][][] {
  const pad = Math.ceil(BLUR_LEVELS[BLUR_LEVELS.length - 1] * 2.5) + 2;
  const side = Math.ceil((glyph + pad * 2) * dpr);
  return colours.map((colour) =>
    BLUR_LEVELS.map((blur) =>
      Array.from({ length: OPEN_LEVELS }, (_, o) => {
        const c = document.createElement("canvas");
        c.width = side;
        c.height = side;
        const g = c.getContext("2d");
        if (!g) return c;
        g.scale(dpr, dpr);
        g.translate(side / dpr / 2, side / dpr / 2);
        if (blur > 0 && "filter" in g) g.filter = `blur(${blur}px)`;
        g.strokeStyle = colour;
        g.lineWidth = Math.max(1.3, glyph * 0.11);
        g.lineCap = "round";
        g.lineJoin = "round";
        drawGripper(g, glyph, o / (OPEN_LEVELS - 1));
        return c;
      }),
    ),
  );
}

function drawBones(ctx: CanvasRenderingContext2D, pts: Pt[], scale: number, layer: "front" | "back") {
  for (const [a, b, w, l] of HAND_BONES) {
    if (l !== layer) continue;
    ctx.lineWidth = scale * w;
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.stroke();
  }
}

function drawHand(ctx: CanvasRenderingContext2D, pts: Pt[], palm: Pt[], s: number, angle: number, ink: string, paper: string) {
  const back = { x: -Math.cos(angle), y: -Math.sin(angle) };
  const wrist = pts[0];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // The three relaxed fingers sit behind the pinch, printed lighter, like a second pass of ink.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.3;
  drawBones(ctx, pts, s, "back");
  ctx.globalAlpha = 1;
  // The forearm starts inside the palm and widens a little toward the elbow, off the frame.
  const side = { x: -back.y, y: back.x };
  const arm: Array<[number, number]> = [
    [-0.3, 0.2],
    [5, 0.27],
    [5, -0.27],
    [-0.3, -0.2],
  ];
  ctx.fillStyle = ink;
  ctx.beginPath();
  arm.forEach(([along, across], k) => {
    const x = wrist.x + back.x * s * along + side.x * s * across;
    const y = wrist.y + back.y * s * along + side.y * s * across;
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  palm.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.06;
  ctx.stroke();
  drawBones(ctx, pts, s, "front");
  // The tracking landmarks of the pinch, faint on the ink: the hand is data from the start.
  ctx.fillStyle = paper;
  ctx.globalAlpha = 0.55;
  for (const i of [0, 2, 3, 4, 5, 6, 7, 8]) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, Math.max(1.3, s * 0.011), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** `avoid`: an element over the canvas (the hero text); copies that drift behind it fade back. */
export function HeroCanvas({ label, avoid }: { label: string; avoid?: RefObject<HTMLElement> }) {
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

    let L = layoutFor(box.clientWidth, box.clientHeight);
    let sprites = makeSprites(L.glyph, L.dpr, [ink, accent]);
    let bodies: Body[] = [];
    let born: number[] = [];
    let flash: number[] = [];
    let seen = 0;
    let frame = 0;
    let last = 0;
    let clock = 0;
    let visible = true;
    let keepOut = { x0: 0, y0: 0, x1: 0, y1: 0 };
    const measureKeepOut = () => {
      const a = avoid?.current;
      if (!a) return;
      const o = box.getBoundingClientRect();
      // Only the text itself: the copy block's children, padded a little.
      const kids = Array.from(a.children).map((c) => c.getBoundingClientRect());
      if (!kids.length) return;
      const pad = 14;
      keepOut = {
        x0: Math.min(...kids.map((r) => r.left)) - o.left - pad,
        y0: Math.min(...kids.map((r) => r.top)) - o.top - pad,
        x1: Math.max(...kids.map((r) => r.right)) - o.left + pad,
        y1: Math.max(...kids.map((r) => r.bottom)) - o.top + pad,
      };
    };

    const size = () => {
      L = layoutFor(box.clientWidth, box.clientHeight);
      sprites = makeSprites(L.glyph, L.dpr, [ink, accent]);
      el.width = Math.round(L.w * L.dpr);
      el.height = Math.round(L.h * L.dpr);
      bodies = bodies.slice(0, L.cap);
      measureKeepOut();
    };

    const handAt = (t: number) => {
      const { pinch } = pinchCycle(t);
      // Slow and heavy: long, out-of-step periods, and a small push forward on each close.
      const push = pinch * L.scale * 0.06;
      const ang = L.angle + 0.035 * Math.sin(t / 1700);
      const wrist = {
        x: L.wrist.x + L.w * 0.012 * Math.sin(t / 2300) + Math.cos(ang) * push,
        y: L.wrist.y + L.h * 0.018 * Math.sin(t / 1500 + 1) + Math.sin(ang) * push,
      };
      const place = { ...wrist, scale: L.scale, angle: ang, mirror: true };
      const pts = handPose({ ...place, pinch });
      const tip = { x: (pts[4].x + pts[8].x) / 2, y: (pts[4].y + pts[8].y) / 2 };
      const ahead = L.spacing * 0.6;
      return { pts, palm: palmOutline(place), pinch, ang, apex: { x: tip.x + Math.cos(ang) * ahead, y: tip.y + Math.sin(ang) * ahead } };
    };

    const slotAt = (i: number, apex: Pt, ang: number, t: number): Pt => {
      const s = L.slots[i];
      const c = Math.cos(ang);
      const n = Math.sin(ang);
      const jitter = reduced ? 0 : 1.1;
      return {
        x: apex.x + s.x * c - s.y * n + jitter * Math.sin(t / 260 + i * 1.7),
        y: apex.y + s.x * n + s.y * c + jitter * Math.cos(t / 310 + i * 2.3),
      };
    };

    const draw = (t: number, dt: number) => {
      const { pts, palm, ang, apex } = handAt(t);
      const closes = reduced ? 8 : pinchCycle(t).closes;
      const want = population(closes, L.cap);

      if (bodies.length === 0) {
        const p = reduced ? slotAt(0, apex, ang, t) : apex;
        bodies = [{ x: p.x, y: p.y, vx: 0, vy: 0 }];
        born = [t];
        flash = [-Infinity];
      }
      if (want > bodies.length) {
        const before = bodies.length;
        for (let k = before; k < want; k++) {
          const parent = bodies[parentOf(k, before)] ?? bodies[0];
          const kick = reduced ? 0 : 140;
          const start = reduced ? slotAt(k, apex, ang, t) : parent;
          bodies.push({ x: start.x, y: start.y, vx: parent.vx + (Math.random() - 0.5) * kick, vy: parent.vy + (Math.random() - 0.5) * kick });
          born.push(reduced ? -Infinity : t);
          flash.push(-Infinity);
        }
      }
      // Once the swarm is full, each close sends a ripple of the accent out through it.
      if (closes > seen) {
        if (seen > 0 && bodies.length >= L.cap) for (let i = 0; i < bodies.length; i++) flash[i] = t + L.slots[i].row * 45;
        seen = closes;
      }

      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      ctx.clearRect(0, 0, L.w, L.h);

      // Far copies first, so the crisp near ones sit on top.
      const order = bodies.map((_, i) => i).sort((a, b) => L.slots[b].depth - L.slots[a].depth);
      const side = sprites[0][0][0].width / L.dpr;
      for (const i of order) {
        const slot = L.slots[i];
        const target = slotAt(i, apex, ang, t);
        bodies[i] = reduced ? { x: target.x, y: target.y, vx: 0, vy: 0 } : springStep(bodies[i], target, dt);
        const b = bodies[i];
        // Each copy repeats the hand's pinch a moment later: the farther out, the later.
        const open = 1 - (reduced ? 0.15 : pinchCycle(t - 90 - slot.row * 22).pinch);
        const o = Math.round(open * (OPEN_LEVELS - 1));
        const blur = Math.min(BLUR_LEVELS.length - 1, Math.floor(slot.depth * BLUR_LEVELS.length));
        const scale = 1.12 - slot.depth * 0.42;
        const facing = Math.atan2(apex.y - b.y, apex.x - b.x);
        const age = t - born[i];
        const grow = age < 260 ? age / 260 : 1;
        const behindText = b.x > keepOut.x0 && b.x < keepOut.x1 && b.y > keepOut.y0 && b.y < keepOut.y1;
        ctx.globalAlpha = (0.95 - slot.depth * 0.5) * (behindText ? 0.12 : 1);
        ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        ctx.translate(b.x, b.y);
        ctx.rotate(facing);
        ctx.scale(scale * grow, scale * grow);
        ctx.drawImage(sprites[0][blur][o], -side / 2, -side / 2, side, side);
        const lit = Math.max(age < FLASH_MS ? 1 - age / FLASH_MS : 0, Math.max(0, 1 - Math.abs(t - flash[i]) / 260));
        if (lit > 0) {
          ctx.globalAlpha = lit * (behindText ? 0.12 : 1);
          ctx.drawImage(sprites[1][blur][o], -side / 2, -side / 2, side, side);
        }
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      drawHand(ctx, pts, palm, L.scale, ang, ink, paper);
    };

    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      // Hidden tabs pause the loop, so a long gap here is a slow frame: let the clock keep up.
      clock += Math.min(dt, 0.5) * 1000;
      draw(clock, dt);
      frame = requestAnimationFrame(loop);
    };

    const play = () => {
      if (reduced || frame || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const pause = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    size();
    if (reduced) draw(CYCLE.first, 0);
    else play();

    const ro = new ResizeObserver(() => {
      size();
      if (reduced) draw(CYCLE.first, 0);
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
    const onVis = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVis);

    return () => {
      pause();
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  return (
    <div ref={wrap} className="sl-hero__stage">
      <canvas
        ref={canvas}
        className="sl-hero__canvas"
        role="img"
        aria-label={label}
      />
    </div>
  );
}
