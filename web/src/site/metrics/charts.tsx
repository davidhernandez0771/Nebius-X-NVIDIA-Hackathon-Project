// The 2D figures of /metrics, in SVG: the climb (every pillar with its Wilson interval and the goal line), the RL
// teacher's curve with and without human demo starts, and Stage A's checkpoint selection. Each is a figure with a
// text label carrying its numbers; the climb also has a visible table. Numbers come in from model.ts / proofData.ts.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { TEACHER } from "../results/proofData";
import { ciText, pctText, rateCi, teacherPath, type Pillar, type Selection } from "./model";

/** Marks a chart seen once it scrolls into view, so its one draw-in plays where someone can see it (CSS does the
 *  drawing, and none with reduced motion). Without IntersectionObserver it is seen at once. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver !== "function");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

// ------------------------------------------------------------------ the climb

const W = 640;
const HT = 300;
const PAD = { l: 44, r: 16, t: 34, b: 52 };
const PW = W - PAD.l - PAD.r;
const PH = HT - PAD.t - PAD.b;
const BAR = 30;

const y = (v: number) => PAD.t + PH * (1 - v);
/** A bar from the baseline to v, its top corners rounded 4px (the data end), its base square. */
function barPath(x: number, v: number): string {
  const top = y(v);
  const base = y(0);
  const r = Math.min(4, (base - top) / 2);
  if (base - top < 0.5) return `M ${x} ${base} h ${BAR}`;
  return `M ${x} ${base} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + BAR - r} Q ${x + BAR} ${top} ${x + BAR} ${top + r} V ${base} Z`;
}

function slots(pillars: Pillar[]): number[] {
  const gaps = pillars.filter((p, i) => i > 0 && p.series !== pillars[i - 1].series).length;
  const step = PW / (pillars.length + gaps * 0.6);
  let at = PAD.l + step / 2;
  return pillars.map((p, i) => {
    if (i > 0 && p.series !== pillars[i - 1].series) at += step * 0.6;
    const x = at;
    at += step;
    return x;
  });
}

export function ClimbChart({ pillars, goal, goalLabel }: { pillars: Pillar[]; goal: number; goalLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const xs = slots(pillars);
  const climb = pillars.filter((p) => p.series === "climb");
  const scripted = pillars.filter((p) => p.series === "scripted");
  const label =
    `The climb, success on unseen scenes against a goal of ${goalLabel}: ` +
    pillars.map((p) => `${p.tag} ${p.k}/${p.n} (Wilson 95% CI ${ciText(p.ci, "pct")})`).join("; ") +
    `. Only ${pillars.filter((p) => p.metGoal).map((p) => p.tag).join(", ")} is past the goal.`;
  const firstScripted = pillars.findIndex((p) => p.series === "scripted");
  const [ref, seen] = useSeen<HTMLDivElement>();

  return (
    <div className="mx-chart" ref={ref} data-seen={seen ? "true" : undefined}>
      <ul className="mx-legend" aria-label="Series">
        <li data-series="climb">Human mouse demos through SANT ({climb.length} tests)</li>
        <li data-series="scripted">Scripted-expert reference ({scripted.length} tests)</li>
      </ul>
      <svg className="mx-svg" viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v} className="mx-grid">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end">
              {v * 100}%
            </text>
          </g>
        ))}
        {firstScripted > 0 && <line className="mx-divider" x1={(xs[firstScripted - 1] + xs[firstScripted]) / 2} x2={(xs[firstScripted - 1] + xs[firstScripted]) / 2} y1={PAD.t - 10} y2={y(0) + 30} />}
        {pillars.map((p, i) => {
          const x = xs[i] - BAR / 2;
          return (
            <g
              key={p.key}
              className="mx-col"
              data-series={p.series}
              data-hover={hover === i ? "true" : undefined}
              style={{ "--i": i } as CSSProperties}
              onMouseEnter={() => setHover(i)}
            >
              <rect className="mx-col__hit" x={xs[i] - 34} y={PAD.t - 24} width={68} height={PH + 24 + PAD.b - 4} />
              <path className="mx-bar" d={barPath(x, p.k / p.n)} />
              <g className="mx-ci">
                <line x1={xs[i]} x2={xs[i]} y1={y(p.ci[0])} y2={y(p.ci[1])} />
                <line x1={xs[i] - 7} x2={xs[i] + 7} y1={y(p.ci[0])} y2={y(p.ci[0])} />
                <line x1={xs[i] - 7} x2={xs[i] + 7} y1={y(p.ci[1])} y2={y(p.ci[1])} />
              </g>
              <text className="mx-val" x={xs[i]} y={y(p.ci[1]) - 9} textAnchor="middle">
                {p.k}/{p.n}
              </text>
              <text className="mx-tick" x={xs[i]} y={y(0) + 20} textAnchor="middle">
                {p.tag.split(" ").map((w, j) => (
                  <tspan key={w} x={xs[i]} dy={j ? "1.2em" : 0}>
                    {w}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
        <g className="mx-goal">
          <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)} />
          <text x={PAD.l + 6} y={y(goal) - 6} textAnchor="start">
            Goal {Math.round(goal * 100)}%
          </text>
        </g>
        <line className="mx-axis" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
      </svg>
      <p className="mx-readout" aria-hidden="true">
        {hover === null ? "Point at a column for its count, interval and seeds." : `${pillars[hover].tag}: ${rateCi(pillars[hover])}`}
      </p>
    </div>
  );
}

export function ClimbTable({ pillars }: { pillars: Pillar[] }) {
  return (
    <table className="mx-table">
      <caption>Success on unseen scenes, with Wilson 95% intervals</caption>
      <thead>
        <tr>
          <th scope="col">Test</th>
          <th scope="col">Successes</th>
          <th scope="col">Rate</th>
          <th scope="col">Wilson 95% CI</th>
          <th scope="col">Test seeds</th>
        </tr>
      </thead>
      <tbody>
        {pillars.map((p) => (
          <tr key={p.key} data-series={p.series} data-goal={p.metGoal ? "met" : undefined}>
            <th scope="row">
              <span className="mx-table__tag">{p.tag}</span> {p.label}
            </th>
            <td>
              {p.k}/{p.n}
            </td>
            <td>{pctText(p.k, p.n)}</td>
            <td>{ciText(p.ci)}</td>
            <td>{p.seeds}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ the teacher

const TW = 640;
const TH = 260;
const TP = { l: 44, r: 92, t: 20, b: 52 };
const X_MAX = 1500;

export function TeacherChart() {
  const w = TW - TP.l - TP.r;
  const h = TH - TP.t - TP.b;
  const { n, curve, final } = TEACHER;
  const series = [
    { key: "with", label: "With human demo starts", pts: curve.map((c) => ({ x: c.iteration, y: c.withDemos })), end: final.withDemos },
    { key: "without", label: "Without", pts: curve.map((c) => ({ x: c.iteration, y: c.withoutDemos })), end: final.withoutDemos },
  ];
  const last = curve[curve.length - 1];
  const px = (x: number) => TP.l + (x / X_MAX) * w;
  const py = (v: number) => TP.t + h - (v / n) * h;
  const [hover, setHover] = useState<number | null>(null);
  const label =
    `The RL teacher, home-start success out of ${n} by training iteration. ` +
    series.map((s) => `${s.label}: ${s.pts.map((p) => p.y).join(", ")}, ending at ${s.end.k}/${s.end.n} (Wilson 95% CI ${ciText(s.end.ci, "pct")})`).join(". ") +
    ".";
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div className="mx-chart" ref={ref} data-seen={seen ? "true" : undefined}>
      <ul className="mx-legend" aria-label="Series">
        <li data-series="climb">With human demo starts</li>
        <li data-series="scripted">Without (same code, budget and seed)</li>
      </ul>
      <svg className="mx-svg" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v} className="mx-grid">
            <line x1={TP.l} x2={TP.l + w} y1={py(v * n)} y2={py(v * n)} />
            <text x={TP.l - 8} y={py(v * n) + 4} textAnchor="end">
              {v * 100}%
            </text>
          </g>
        ))}
        {curve.map((c, i) => (
          <g key={c.iteration} className="mx-grid">
            <text x={px(c.iteration)} y={TH - TP.b + 20} textAnchor="middle">
              {c.iteration}
            </text>
            <rect className="mx-col__hit" x={px(c.iteration) - 30} y={TP.t} width={60} height={h} onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {hover !== null && <line className="mx-cross" x1={px(curve[hover].iteration)} x2={px(curve[hover].iteration)} y1={TP.t} y2={TP.t + h} />}
        <line className="mx-axis" x1={TP.l} x2={TP.l + w} y1={py(0)} y2={py(0)} />
        {series.map((s, si) => (
          <g key={s.key} className="mx-line" data-series={si === 0 ? "climb" : "scripted"}>
            <path d={teacherPath(s.pts, { w, h, xMax: X_MAX, yMax: n })} transform={`translate(${TP.l} ${TP.t})`} pathLength={1} />
            {s.pts.map((p) => (
              <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r={4.5} />
            ))}
            <text className="mx-val" x={px(last.iteration) + 12} y={py(s.end.k) + (si === 0 ? 4 : -6)}>
              {s.end.k}/{s.end.n}
            </text>
          </g>
        ))}
        <text className="mx-axis-title" x={TP.l + w / 2} y={TH - 4} textAnchor="middle">
          RL training iteration
        </text>
      </svg>
      <p className="mx-readout" aria-hidden="true">
        {hover === null
          ? "Point at an iteration for both counts."
          : `Iteration ${curve[hover].iteration}: ${curve[hover].withDemos}/${n} with demo starts, ${curve[hover].withoutDemos}/${n} without.`}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Stage A's selection

export function SelectionBars({ sel }: { sel: Selection }) {
  return (
    <ol className="mx-sel">
      {sel.steps.map((s) => (
        <li key={s.label} className="mx-sel__row" data-picked={s.label === sel.picked ? "true" : undefined}>
          <span className="mx-sel__label">{s.label} steps</span>
          <span className="mx-sel__track" aria-hidden="true">
            <span className="mx-sel__fill" style={{ width: `${(100 * s.k) / s.n}%` }} />
          </span>
          <span className="mx-sel__count">{`${s.k}/${s.n}`}</span>
          <span className="mx-sel__pick">{s.label === sel.picked ? "picked" : ""}</span>
        </li>
      ))}
    </ol>
  );
}
