// /record's instruments, after docs/design/prototypes/record-hologram.html: the gripper dial with its
// orange needle, the height and left/right gauges and the bottom trace (the robot twin is the 3D one, web/src/twin).
// Each is an SVG drawn at its pane's pixel size (measured), so lines stay 1 px and text never scales.

import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import { knobAngle } from "../record-hud";
import { LIVE_HISTORY } from "./liveHud";
import { PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE } from "../../record/teleop/pinch";
import { WORKSPACE, traceX, tracePath, type LiveState } from "./twin";

type Size = { w: number; h: number };

/** The element's content size, kept current with a ResizeObserver (0 x 0 where there is none, e.g. jsdom). */
function useSize<T extends Element>(): [RefCallback<T>, Size] {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "function") {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(el);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size];
}

/** Polar point: angle in degrees, 0 at the top, clockwise. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}

const DIAL_TICKS = Array.from({ length: 9 }, (_, k) => -135 + k * 33.75);

/**
 * The gripper dial: the orange needle is the pinch gap (thumb tip to index tip, the value the latch
 * reads), the two marks are where the latch closes (below 0.25) and opens again (above 0.50).
 */
export function GripDial({ pinch, gripper, stale }: { pinch: number | null; gripper: 0 | 1 | null; stale: boolean }) {
  const [ref, { w, h }] = useSize<SVGSVGElement>();
  const cx = w / 2;
  const cy = h * 0.46;
  const R = Math.min(w, h) * 0.26;
  const state = gripper === null ? null : gripper ? "closed" : "open";
  const text = state === null ? "no hand" : pinch === null ? `${state} · hand lost` : `${state} · pinch gap ${pinch.toFixed(2)}`;
  const needle = pinch === null ? null : knobAngle(pinch, 0, 1);
  return (
    <svg
      ref={ref}
      className="rg-svg"
      role="meter"
      aria-label="Gripper"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={pinch ?? undefined}
      aria-valuetext={text}
      width={w || undefined}
      height={h || undefined}
      data-stale={stale || undefined}
    >
      {R > 0 && (
        <>
          <circle className="rg-dial" cx={cx} cy={cy} r={R} />
          {DIAL_TICKS.map((a, k) => {
            const major = k % 4 === 0;
            const [x1, y1] = polar(cx, cy, R + 6, a);
            const [x2, y2] = polar(cx, cy, R + (major ? 14 : 10), a);
            return <line key={k} className={major ? "rg-tick rg-tick--major" : "rg-tick"} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          {[
            { v: PINCH_CLOSE_BELOW, cls: "rg-mark rg-mark--close" },
            { v: PINCH_OPEN_ABOVE, cls: "rg-mark rg-mark--open" },
          ].map(({ v, cls }) => {
            const a = knobAngle(v, 0, 1);
            const [x1, y1] = polar(cx, cy, R - 4, a);
            const [x2, y2] = polar(cx, cy, R + 4, a);
            return <line key={v} className={cls} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          {needle !== null && (
            <line className="rg-needle" x1={polar(cx, cy, R * 0.25, needle)[0]} y1={polar(cx, cy, R * 0.25, needle)[1]} x2={polar(cx, cy, R * 0.85, needle)[0]} y2={polar(cx, cy, R * 0.85, needle)[1]} />
          )}
          <circle className="rg-hub" cx={cx} cy={cy} r={2} />
        </>
      )}
    </svg>
  );
}

/** The height gauge: the arm target's height over the table, on a 10-step scale of the workspace's z range. */
export function HeightGauge({ z, stale }: { z: number | null; stale: boolean }) {
  const [ref, { w, h }] = useSize<SVGSVGElement>();
  const [lo, hi] = WORKSPACE.z;
  const bx = w - 36;
  const top = 30;
  const bot = h - 50;
  const f = z === null ? null : Math.min(1, Math.max(0, (z - lo) / (hi - lo)));
  return (
    <svg
      ref={ref}
      className="rg-svg"
      role="meter"
      aria-label="Arm height"
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuenow={z ?? undefined}
      aria-valuetext={z === null ? "no target" : `${z.toFixed(2)} m`}
      width={w || undefined}
      height={h || undefined}
      data-stale={stale || undefined}
    >
      {bot > top && (
        <>
          {Array.from({ length: 11 }, (_, k) => {
            const y = bot - ((bot - top) * k) / 10;
            return <line key={k} className={k % 5 ? "rg-tick" : "rg-tick rg-tick--major"} x1={bx} y1={y} x2={bx + (k % 5 ? 6 : 12)} y2={y} />;
          })}
          {f !== null && <rect className="rg-level" x={bx - 10} y={bot - (bot - top) * f - 1} width={22} height={2} />}
        </>
      )}
    </svg>
  );
}

/**
 * The left/right gauge, the height gauge's ladder laid on its side: the arm target's y on a 10-step scale of the
 * workspace's y range, the robot's left (+y) on the left, as the operator stands and the mirrored camera shows.
 */
/** facing (the mirror mapping): the robot faces you, so its left is on your right; the needle moves the way your hand
 *  does either way, and L / R are your left and right. */
export function SideGauge({ y, stale, facing = false }: { y: number | null; stale: boolean; facing?: boolean }) {
  const [ref, { w, h }] = useSize<SVGSVGElement>();
  const [lo, hi] = WORKSPACE.y;
  const by = Math.round(h * 0.42);
  const left = 22;
  const right = w - 22;
  const behind = y === null ? null : Math.min(1, Math.max(0, (hi - y) / (hi - lo)));
  const f = behind === null ? null : facing ? 1 - behind : behind;
  return (
    <svg
      ref={ref}
      className="rg-svg"
      role="meter"
      aria-label="Arm left/right"
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuenow={y ?? undefined}
      aria-valuetext={y === null ? "no target" : `${Math.abs(y).toFixed(2)} m to the robot's ${y >= 0 ? "left" : "right"}`}
      width={w || undefined}
      height={h || undefined}
      data-stale={stale || undefined}
    >
      {right > left && by > 30 && (
        <>
          {Array.from({ length: 11 }, (_, k) => {
            const x = left + ((right - left) * k) / 10;
            return <line key={k} className={k % 5 ? "rg-tick" : "rg-tick rg-tick--major"} x1={x} y1={by} x2={x} y2={by + (k % 5 ? 6 : 12)} />;
          })}
          <text className="rg-svg-label" x={left} y={by + 26} textAnchor="middle">
            L
          </text>
          <text className="rg-svg-label" x={right} y={by + 26} textAnchor="middle">
            R
          </text>
          {f !== null && <rect className="rg-level" x={left + (right - left) * f - 1} y={by - 10} width={2} height={22} />}
        </>
      )}
    </svg>
  );
}

/** The bottom trace: height (teal) and reach (ink) over the last 8 s, orange ticks while the gripper is closed. */
export function Trace({ live }: { live: LiveState }) {
  const [ref, { w, h }] = useSize<SVGSVGElement>();
  const { zHistory, xHistory } = live.hud;
  const grip = live.gripHistory;
  const step = w / (LIVE_HISTORY - 1);
  return (
    <svg ref={ref} className="rg-svg" role="img" aria-label="Trace of the last 8 s: height, reach and grip" width={w || undefined} height={h || undefined}>
      {w > 0 && h > 0 && (
        <>
          <path className="rg-trace rg-trace--z" d={tracePath(zHistory, WORKSPACE.z, w, h * 0.9)} transform={`translate(0 ${h * 0.05})`} />
          <path className="rg-trace rg-trace--x" d={tracePath(xHistory, WORKSPACE.x, w, h * 0.9)} transform={`translate(0 ${h * 0.05})`} />
          {grip.map((g, i) => (g ? <rect key={i} className="rg-grip" x={traceX(i, grip.length, w)} y={h - 3} width={step + 0.5} height={3} /> : null))}
        </>
      )}
    </svg>
  );
}
