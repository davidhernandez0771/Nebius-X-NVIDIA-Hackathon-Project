// The film's small parts: labels, a run drawn from above, a frame from Isaac's camera, bars. Each takes the time it
// should show and draws exactly that (no internal animation state).
import type { CSSProperties, ReactNode } from "react";
import type { Vec3 } from "../../twin/types";
import { filmAsset, type FilmData } from "./data";
import { clamp, enter, type SceneSpan } from "./model";

export type SceneProps = { t: number; span: SceneSpan; data: FilmData };

/** Local time in a scene and its lines' local starts. */
export function local({ t, span }: SceneProps) {
  return { lt: t - span.start, L: span.lines.map((l) => l.start - span.start), dur: span.end - span.start };
}

/** Fade + rise in at `a` (local seconds). */
export function rise(lt: number, a: number, dist = 24, dur = 0.7): CSSProperties {
  const v = enter(lt, a, dur);
  return { opacity: v, transform: `translate3d(0, ${(1 - v) * dist}px, 0)` };
}
export function fadeOut(lt: number, a: number, dur = 0.5): CSSProperties {
  const v = 1 - clamp((lt - a) / dur);
  return { opacity: v };
}

export function Kicker({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: "teal" | "fail" | "dim" }) {
  return (
    <p className="fm-kicker" data-tone={tone} style={style}>
      {children}
    </p>
  );
}

/** The bin's inner half-width (scene_cfg.py BIN_INNER, 0.2 x 0.2 m). */
const BIN_HALF = 0.1;

/**
 * A run seen from above: the bin, the cube's start, the hand's path up to `upto` steps (and the cube's). +x (away from
 * the robot) is up and +y (the robot's left) is left, as from behind the robot.
 */
export function TopPlot({
  hand,
  cube,
  bin,
  upto,
  every = 1,
  verdict = null,
  size = 180,
  dim = false,
}: {
  hand: Vec3[];
  cube?: Vec3[] | null;
  bin: Vec3;
  upto: number;
  every?: number;
  verdict?: "ok" | "fail" | null;
  size?: number;
  dim?: boolean;
}) {
  // the view: x 0.2..0.8 (up), y 0.4..-0.4 (left to right)
  const px = (p: Vec3) => [(0.4 - p[1]) * 100, (0.8 - p[0]) * 100] as const;
  const pts = (arr: Vec3[], n: number) =>
    arr
      .slice(0, Math.max(1, Math.floor(n / every) + 1))
      .map((p) => px(p).map((v) => v.toFixed(1)).join(","))
      .join(" ");
  const [bx, by] = px(bin);
  const head = hand[Math.min(hand.length - 1, Math.floor(upto / every))];
  const [hx, hy] = head ? px(head) : [0, 0];
  const c0 = cube?.[0];
  const cNow = cube?.[Math.min(cube.length - 1, upto)];
  return (
    <svg className="fm-top" data-verdict={verdict ?? undefined} data-dim={dim || undefined} viewBox="0 0 80 60" width={size} height={(size * 60) / 80} aria-hidden="true">
      <rect className="fm-top__bin" x={bx - BIN_HALF * 100} y={by - BIN_HALF * 100} width={BIN_HALF * 200} height={BIN_HALF * 200} />
      {c0 && <rect className="fm-top__cube0" x={px(c0)[0] - 2.5} y={px(c0)[1] - 2.5} width={5} height={5} />}
      {cube && cNow && <rect className="fm-top__cube" x={px(cNow)[0] - 2.5} y={px(cNow)[1] - 2.5} width={5} height={5} />}
      <polyline className="fm-top__hand" points={pts(hand, upto)} />
      {head && <circle className="fm-top__head" cx={hx} cy={hy} r={1.6} />}
    </svg>
  );
}

/** One frame of Isaac's front camera from an atlas (one row per run, `cols` frames across it, 128 px each). */
export function CamTile({ atlas, row, col, cols, rows, size = 128, style }: { atlas: string; row: number; col: number; cols: number; rows: number; size?: number; style?: CSSProperties }) {
  const k = size / 128;
  return (
    <div
      className="fm-cam"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${filmAsset(atlas)})`,
        backgroundSize: `${cols * 128 * k}px ${rows * 128 * k}px`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
        ...style,
      }}
    />
  );
}

/** The demos.jpg row of a demo id. */
export const demoRow = (data: FilmData, id: string) => data.demoRows.indexOf(id);

export function Check({ ok, style }: { ok: boolean; style?: CSSProperties }) {
  return (
    <span className="fm-check" data-ok={ok} style={style} aria-hidden="true">
      {ok ? "✓" : "✕"}
    </span>
  );
}

/** A horizontal count bar: k of n, filled to `fill` (0..1) of its value. */
export function CountBar({ label, k, n, fill, tone = "teal", note, style }: { label: ReactNode; k: number; n: number; fill: number; tone?: "teal" | "dim" | "fail"; note?: ReactNode; style?: CSSProperties }) {
  const shown = Math.round(k * clamp(fill));
  return (
    <div className="fm-cbar" data-tone={tone} style={style}>
      <p className="fm-cbar__label">{label}</p>
      <div className="fm-cbar__track">
        <div className="fm-cbar__fill" style={{ width: `${(100 * k * clamp(fill)) / n}%` }} />
      </div>
      <p className="fm-cbar__num">
        <b>{shown}</b>
        <span> / {n}</span>
      </p>
      {note && <p className="fm-cbar__note">{note}</p>}
    </div>
  );
}
