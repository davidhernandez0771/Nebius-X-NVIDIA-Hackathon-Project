// The story's proof beats (intro-proof, 2026-10-26, the user): the Results page's proof, told in the journey itself,
// so a judge who only scrolls still sees it. After the reactor's beats and before the ring (storyPlan.ts, the proof
// stage) the core holds at full power while four beats take the screen in turn, each on a dim glass panel:
//   05 How SANT works: the pipeline in five steps, lit one by one;
//   06 The proof: the climb 0/40 → 3/40 → 15/40 → 30/40 against the 60% goal, with Wilson intervals;
//   07 Did the human demos matter?: the teacher's curve with and without human demo starts, drawing itself;
//   08 SANT checks the teacher too: the speed gate, 3/50 uncapped, then 50/50 capped.
// Each graph is drawn by the scroll (proofBeatState's `draw`, proofMotion.ts), never by a timer, so scrolling back
// undraws it; with reduced motion it is whole as soon as its beat shows. Every number is from the Results page's
// proofData.ts: nothing here is typed twice. Each beat is a named region you can Tab to (focusing it brings the story
// there); each graph is a figure with a text description and, behind the drawing (aria-hidden), a data table.
// DOM and SVG only: nothing is added to the 3D, and the per-frame work is a few style writes when the draw changes.
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatStat } from "../../../sant/motion/format";
import {
  CLIMB,
  CLIMB_FOOTNOTE_SHORT,
  CLIMB_FOOTNOTE_SOURCE,
  GOAL,
  LEAD,
  TEACHER,
  TEACHER_GATE,
  proofCite,
  type ProofSource,
} from "../../../site/results/proofData";
import { useStationFrame, useWorld } from "../../core/WorldContext";
import { scrollToY } from "../../core/scroll";
import { barGrow, curveReached, stepLight, tallyCount } from "./proofMotion";
import { INTRO_VH, PROOF_BEATS, proofBeatSpan, proofBeatState } from "./storyPlan";
import "./proofBeats.css";

/** Paints a beat's graph at a draw (0–1). */
type Paint = (draw: number) => void;
/** Each figure hands its painter up once mounted. */
type Register = (paint: Paint) => void;

const pct = (k: number, n: number) => `${formatStat((100 * k) / n, 1)}%`;
const ciText = ([lo, hi]: readonly number[]) => `${formatStat(100 * lo, 1)}–${formatStat(100 * hi, 1)}%`;
const at = (x: number) => `${x * 100}%`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const V2 = CLIMB[CLIMB.length - 1];

/** One line of sources: each note once, its cited lines in order ("Distill pre-registration note, lines 9, 1386"). */
export function sourcesLine(sources: readonly ProofSource[]): string {
  const byNote = new Map<ProofSource["note"], string[]>();
  for (const s of sources) for (const l of s.lines.split(",")) byNote.set(s.note, [...(byNote.get(s.note) ?? []), l.trim()]);
  const range = (l: string) => {
    const [a, b = a] = l.split("–").map((v) => parseInt(v, 10));
    return [a, b] as const;
  };
  // In line order, each once, and none already inside a cited range ("440" inside "439–441").
  const tidy = (lines: string[]) =>
    [...new Set(lines)]
      .filter((l) => {
        const [a, b] = range(l);
        return !lines.some((o) => o !== l && range(o)[0] <= a && range(o)[1] >= b);
      })
      .sort((x, y) => range(x)[0] - range(y)[0]);
  return [...byNote].map(([note, lines]) => proofCite({ note, lines: tidy(lines).join(", ") })).join(" · ");
}

/** Where a focused beat is brought to: in its hold, whole and fully shown. */
const HOLD_AT = 0.72;

// ------------------------------------------------------------------ 05 how SANT works

const STEPS: { title: string; line: string }[] = [
  { title: `Record ${LEAD.demos} demos`, line: "By mouse, in the browser: a person drives the arm." },
  { title: "Physics check in Isaac Lab", line: "Each demo is replayed with physics on." },
  { title: "Repair + multiply", line: "Into verified copies: each one must pass physics too." },
  { title: "An RL teacher learns", line: "Starting from those demos, partway through them." },
  { title: "Distilled into a camera-only robot", line: `Then tested once, on ${V2.n} unseen scenes.` },
];

function Pipeline({ register }: { register: Register }) {
  const wire = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  useLayoutEffect(() => {
    register((draw) => {
      wire.current?.style.setProperty("--fill", String(draw));
      items.current.forEach((li, i) => {
        if (!li) return;
        const l = stepLight(draw, i, STEPS.length);
        li.style.opacity = String(0.3 + 0.7 * l);
        li.dataset.lit = String(l >= 0.999);
      });
    });
  }, [register]);
  return (
    <div className="intro-pbeat__pipe">
      <div ref={wire} className="intro-pbeat__wire" aria-hidden="true">
        <span className="intro-pbeat__wire-fill" />
      </div>
      <ol className="intro-pbeat__steps" aria-label="The five steps">
        {STEPS.map((s, i) => (
          <li key={s.title} ref={(el) => (items.current[i] = el)} className="intro-pbeat__step">
            <span className="intro-pbeat__node" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="intro-pbeat__step-title">{s.title}</span>
            <span className="intro-pbeat__step-line">{s.line}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ the figure frame

function Figure({ title, summary, children, caption }: { title: string; summary: ReactNode; children: ReactNode; caption?: ReactNode }) {
  const id = useId();
  return (
    <figure className="intro-pbeat__figure" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <p id={`${id}-t`} className="intro-pbeat__figure-title world-u">
        {title}
      </p>
      <p id={`${id}-d`} className="intro-pbeat__summary">
        {summary}
      </p>
      <div className="intro-pbeat__graph">{children}</div>
      {caption ? <figcaption className="intro-pbeat__caption">{caption}</figcaption> : null}
    </figure>
  );
}

// ------------------------------------------------------------------ 06 the climb

function Climb({ register }: { register: Register }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const whiskers = useRef<(HTMLSpanElement | null)[]>([]);
  const counts = useRef<(HTMLSpanElement | null)[]>([]);
  const goal = GOAL.k / GOAL.n;
  useLayoutEffect(() => {
    register((draw) => {
      CLIMB.forEach((s, i) => {
        const g = barGrow(draw, i, CLIMB.length);
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleX(${(g * s.k) / s.n})`;
        const w = whiskers.current[i];
        if (w) w.style.opacity = String(clamp01((g - 0.85) / 0.15));
        const c = counts.current[i];
        if (c) c.textContent = String(Math.round(g * s.k));
      });
    });
  }, [register]);
  return (
    <Figure
      title={`Success on the ${V2.n}-scene one-shot test`}
      summary={
        <>
          A camera policy drives a Franka arm to put a cube in a bin, in Isaac Lab, on scenes it has never seen. Raw mouse demos{" "}
          {CLIMB[0].k}/{CLIMB[0].n}, SANT-perfected and multiplied {CLIMB[1].k}/{CLIMB[1].n}, the RL teacher distilled in (v1){" "}
          {CLIMB[2].k}/{CLIMB[2].n}, v2 {V2.k}/{V2.n}: the only one past the goal of {GOAL.k}/{GOAL.n}.
        </>
      }
      caption={
        <>
          <span className="intro-pbeat__foot">{CLIMB_FOOTNOTE_SHORT}</span>
          <span className="intro-pbeat__links">
            <Link className="intro-pbeat__link world-u" to="/test-track">
              Watch the real test runs<span aria-hidden="true"> →</span>
            </Link>
            <Link className="intro-pbeat__link world-u" to="/site/results#proof">
              Every number, with its sources<span aria-hidden="true"> →</span>
            </Link>
          </span>
          <span className="intro-pbeat__src">{sourcesLine([...CLIMB.map((s) => s.source), GOAL.source, CLIMB_FOOTNOTE_SOURCE])}</span>
        </>
      }
    >
      <div className="intro-pbeat__plot" aria-hidden="true" style={{ "--goal": at(goal) } as CSSProperties}>
        <span className="intro-pbeat__goal" style={{ left: at(goal) }}>
          <span className="intro-pbeat__goal-label">
            Goal {formatStat(100 * goal, 0)}% · {GOAL.k}/{GOAL.n}
          </span>
        </span>
        {CLIMB.map((s, i) => (
          <div key={s.key} className="intro-pbeat__row" data-hi={s.key === V2.key}>
            <div className="intro-pbeat__row-head">
              <span className="intro-pbeat__tag">{s.tag}</span>
              <span className="intro-pbeat__label">{s.label}</span>
              <span className="intro-pbeat__count">
                <span ref={(el) => (counts.current[i] = el)}>{s.k}</span>/{s.n}
              </span>
            </div>
            <div className="intro-pbeat__track">
              <span ref={(el) => (bars.current[i] = el)} className="intro-pbeat__bar" style={{ transform: `scaleX(${s.k / s.n})` }} />
              <span ref={(el) => (whiskers.current[i] = el)} className="intro-pbeat__whisker" style={{ left: at(s.ci[0]), right: at(1 - s.ci[1]) }} />
            </div>
          </div>
        ))}
        <div className="intro-pbeat__axis">
          {[0, 0.5, 1].map((t) => (
            <span key={t} style={{ left: at(t) }}>
              {t * 100}%
            </span>
          ))}
        </div>
      </div>
      <table className="world-sr">
        <caption>
          Success on the {V2.n}-scene one-shot test, with Wilson 95% intervals. Goal: {GOAL.k}/{GOAL.n}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Recipe</th>
            <th scope="col">Successes</th>
            <th scope="col">Rate</th>
            <th scope="col">Wilson 95% CI</th>
            <th scope="col">Test seeds</th>
          </tr>
        </thead>
        <tbody>
          {CLIMB.map((s) => (
            <tr key={s.key}>
              <th scope="row">
                {s.tag}: {s.label}
              </th>
              <td>
                {s.k}/{s.n}
              </td>
              <td>{pct(s.k, s.n)}</td>
              <td>{ciText(s.ci)}</td>
              <td>{s.seeds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  );
}

// ------------------------------------------------------------------ 07 the teacher, with and without demo starts

const FIRST = TEACHER.curve[0].iteration;
const LAST = TEACHER.curve[TEACHER.curve.length - 1].iteration;
const XS = TEACHER.curve.map((c) => (c.iteration - FIRST) / (LAST - FIRST));
const yAt = (k: number) => 1 - k / TEACHER.n;
const points = (pick: (c: (typeof TEACHER.curve)[number]) => number) => TEACHER.curve.map((c, i) => `${100 * XS[i]},${100 * yAt(pick(c))}`).join(" ");

function readoutText(i: number) {
  const c = TEACHER.curve[i];
  return `Iteration ${c.iteration} · with demo starts ${c.withDemos}/${TEACHER.n} · without ${c.withoutDemos}/${TEACHER.n}`;
}

function Teacher({ register }: { register: Register }) {
  const lines = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const ends = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const reached = useRef(-1);
  useLayoutEffect(() => {
    reached.current = -1;
    register((draw) => {
      // The lines draw left to right with the scroll (a clip; the stroke itself never moves).
      if (lines.current) lines.current.style.clipPath = draw >= 1 ? "none" : `inset(-8px ${(100 * (1 - draw)).toFixed(2)}% -8px -8px)`;
      dots.current.forEach((d, j) => {
        if (d) d.dataset.on = String(draw >= XS[Math.floor(j / 2)] - 1e-9);
      });
      if (ends.current) ends.current.style.opacity = String(clamp01((draw - 0.94) / 0.06));
      const r = curveReached(draw, XS);
      if (r !== reached.current && readout.current) {
        reached.current = r;
        readout.current.textContent = readoutText(r);
      }
    });
  }, [register]);
  const { withDemos, withoutDemos } = TEACHER.final;
  return (
    <Figure
      title={`Home-start success out of ${TEACHER.n}, by RL training iteration`}
      summary={
        <>
          The RL teacher was trained twice: once with episodes that start partway through a human demo, once from the robot's home pose only.
          Tested from home on the same {TEACHER.n} scenes, with demo starts it reached {TEACHER.curve.map((c) => c.withDemos).join(", ")} at
          iterations {TEACHER.curve.map((c) => c.iteration).join(", ")}; without them, 0/{TEACHER.n} at every checkpoint.
        </>
      }
      caption={
        <>
          <span className="intro-pbeat__foot">{TEACHER.caption}</span>
          <span className="intro-pbeat__src">{sourcesLine([TEACHER.source, TEACHER.finalSource])}</span>
        </>
      }
    >
      <ul className="intro-pbeat__legend" aria-hidden="true">
        <li data-series="with">
          <span className="intro-pbeat__key" />
          With human demo starts
        </li>
        <li data-series="without">
          <span className="intro-pbeat__key" />
          Without (home starts only)
        </li>
      </ul>
      <div className="intro-pbeat__curve" aria-hidden="true">
        <div className="intro-pbeat__yaxis">
          {[1, 0.5, 0].map((t) => (
            <span key={t} style={{ top: at(1 - t) }}>
              {Math.round(t * TEACHER.n)}
            </span>
          ))}
        </div>
        <div className="intro-pbeat__cplot">
          {[0, 0.5, 1].map((t) => (
            <span key={t} className="intro-pbeat__grid" style={{ top: at(t) }} />
          ))}
          <div ref={lines} className="intro-pbeat__lines">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline data-series="without" points={points((c) => c.withoutDemos)} vectorEffect="non-scaling-stroke" />
              <polyline data-series="with" points={points((c) => c.withDemos)} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          {TEACHER.curve.map((c, i) => [
            <span
              key={`w${c.iteration}`}
              ref={(el) => (dots.current[2 * i] = el)}
              className="intro-pbeat__dot"
              data-series="with"
              style={{ left: at(XS[i]), top: at(yAt(c.withDemos)) }}
            />,
            <span
              key={`o${c.iteration}`}
              ref={(el) => (dots.current[2 * i + 1] = el)}
              className="intro-pbeat__dot"
              data-series="without"
              style={{ left: at(XS[i]), top: at(yAt(c.withoutDemos)) }}
            />,
          ])}
          <div ref={ends} className="intro-pbeat__ends">
            <span data-series="with" style={{ top: at(yAt(withDemos.k)) }}>
              {withDemos.k}/{withDemos.n}
            </span>
            <span data-series="without" style={{ top: at(yAt(withoutDemos.k)) }}>
              {withoutDemos.k}/{withoutDemos.n}
            </span>
          </div>
        </div>
        <div className="intro-pbeat__xaxis">
          {TEACHER.curve.map((c, i) => (
            <span key={c.iteration} style={{ left: at(XS[i]) }}>
              {c.iteration}
            </span>
          ))}
        </div>
      </div>
      <p ref={readout} className="intro-pbeat__readout" aria-hidden="true">
        {readoutText(TEACHER.curve.length - 1)}
      </p>
      <table className="world-sr">
        <caption>Home-start success out of {TEACHER.n}, by RL training iteration</caption>
        <thead>
          <tr>
            <th scope="col">Iteration</th>
            <th scope="col">With human demo starts</th>
            <th scope="col">Without</th>
          </tr>
        </thead>
        <tbody>
          {TEACHER.curve.map((c) => (
            <tr key={c.iteration}>
              <th scope="row">{c.iteration}</th>
              <td>
                {c.withDemos}/{TEACHER.n}
              </td>
              <td>
                {c.withoutDemos}/{TEACHER.n}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  );
}

// ------------------------------------------------------------------ 08 the teacher's speed gate

const GATE_ROWS = [
  {
    key: "before",
    tag: "Uncapped",
    label: `median ${TEACHER_GATE.before.speed} m/s · seeds ${TEACHER_GATE.before.seeds.join("–")}`,
    side: TEACHER_GATE.before,
    pass: (j: number) => TEACHER_GATE.before.passedSeeds.includes(TEACHER_GATE.before.seeds[0] + j),
  },
  {
    key: "after",
    tag: "Capped",
    label: `at ${TEACHER_GATE.after.speed} m/s · fresh seeds ${TEACHER_GATE.after.seeds.join("–")}`,
    side: TEACHER_GATE.after,
    pass: () => true,
  },
] as const;

function Gate({ register }: { register: Register }) {
  const rows = useRef<(HTMLOListElement | null)[]>([]);
  const counts = useRef<(HTMLSpanElement | null)[]>([]);
  const filled = useRef<number[]>([]);
  useLayoutEffect(() => {
    filled.current = [];
    register((draw) => {
      GATE_ROWS.forEach((r, i) => {
        const n = tallyCount(draw, i, r.side.n);
        if (n === filled.current[i]) return;
        filled.current[i] = n;
        const cells = rows.current[i]?.children;
        if (cells) for (let j = 0; j < cells.length; j++) (cells[j] as HTMLElement).dataset.on = String(j < n);
        const c = counts.current[i];
        if (c) c.textContent = String(Array.from({ length: n }, (_, j) => r.pass(j)).filter(Boolean).length);
      });
    });
  }, [register]);
  const { before, after, passMark } = TEACHER_GATE;
  return (
    <Figure
      title="SANT's physics replay of the RL teacher, out of 50 scenes"
      summary={
        <>
          Before anything was learned from it, the teacher had to pass SANT's own physics replay: at least {passMark.k}/{passMark.n}. Moving its
          tool at a median {before.speed} m/s, it passed {before.k}/{before.n}. Capped at {after.speed} m/s, on fresh scenes, it passed {after.k}/
          {after.n}.
        </>
      }
      caption={<span className="intro-pbeat__src">{sourcesLine([passMark.source, ...before.sources, ...after.sources])}</span>}
    >
      <div className="intro-pbeat__gate" aria-hidden="true" style={{ "--pass": at(passMark.k / passMark.n) } as CSSProperties}>
        {GATE_ROWS.map((r, i) => (
          <div key={r.key} className="intro-pbeat__gate-row" data-row={r.key}>
            <div className="intro-pbeat__row-head">
              <span className="intro-pbeat__tag">{r.tag}</span>
              <span className="intro-pbeat__label">{r.label}</span>
              <span className="intro-pbeat__count">
                <span ref={(el) => (counts.current[i] = el)}>{r.side.k}</span>/{r.side.n}
              </span>
            </div>
            <ol ref={(el) => (rows.current[i] = el)} className="intro-pbeat__tally">
              {Array.from({ length: r.side.n }, (_, j) => (
                <li key={j} data-pass={r.pass(j)} data-on="true" />
              ))}
            </ol>
          </div>
        ))}
        <p className="intro-pbeat__gate-key">
          <span data-k="pass">
            <i /> passed
          </span>
          <span data-k="fail">
            <i /> failed
          </span>
          <span data-k="mark">
            <i /> pass mark ≥ {passMark.k}/{passMark.n}
          </span>
        </p>
      </div>
      <table className="world-sr">
        <caption>SANT's physics replay of the RL teacher; the pass mark is {passMark.k}/{passMark.n}</caption>
        <thead>
          <tr>
            <th scope="col">Teacher</th>
            <th scope="col">Passed</th>
            <th scope="col">Wilson 95% CI</th>
            <th scope="col">Seeds</th>
          </tr>
        </thead>
        <tbody>
          {GATE_ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.tag}, {r.key === "before" ? `median ${r.side.speed} m/s` : `${r.side.speed} m/s`}
              </th>
              <td>
                {r.side.k}/{r.side.n}
              </td>
              <td>{ciText(r.side.ci)}</td>
              <td>{r.side.seeds.join("–")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  );
}

// ------------------------------------------------------------------ the beats

interface BeatCopy {
  kicker: string;
  head: string[];
  Graph: (p: { register: Register }) => JSX.Element;
  key: string;
}

const BEATS: BeatCopy[] = [
  { key: "pipeline", kicker: "05 / How SANT works", head: [`${LEAD.demos} demos in.`, "A tested robot out."], Graph: Pipeline },
  { key: "climb", kicker: "06 / The proof", head: [`${CLIMB[0].k}/${CLIMB[0].n} → ${V2.k}/${V2.n}`], Graph: Climb },
  { key: "teacher", kicker: "07 / The teacher", head: ["Did the human", "demos matter?"], Graph: Teacher },
  { key: "gate", kicker: "08 / Checked twice", head: ["SANT checks", "the teacher too"], Graph: Gate },
];

if (BEATS.length !== PROOF_BEATS) throw new Error("ProofBeats: one beat per proof span (storyPlan.ts PROOF_BEATS)");

export function ProofBeats() {
  const { store, reduced } = useWorld();
  const id = useId();
  const roots = useRef<(HTMLElement | null)[]>([]);
  const painters = useRef<(Paint | null)[]>([]);
  const last = useRef<{ shown: number; draw: number }[]>([]);
  // Stable per beat, so the figures register once.
  const registers = useRef(BEATS.map((_, i) => (p: Paint) => (painters.current[i] = p)));

  useLayoutEffect(() => {
    // A change of motion (reduced on or off) repaints everything.
    last.current = [];
  }, [reduced]);

  useStationFrame("intro", (f) => {
    const ready = store.getCoarse().ready;
    const vh = f.t * INTRO_VH;
    BEATS.forEach((_, i) => {
      const el = roots.current[i];
      if (!el) return;
      const s = proofBeatState(vh, i);
      const shown = ready ? s.shown : 0;
      const draw = reduced ? 1 : s.draw;
      const prev = last.current[i];
      if (prev && prev.shown === shown && prev.draw === draw) return;
      last.current[i] = { shown, draw };
      el.style.opacity = String(shown);
      el.dataset.shown = String(shown > 0.5);
      el.style.transform = reduced ? "" : `translate3d(0, ${((1 - shown) * 1.6).toFixed(3)}vh, 0)`;
      if (!prev || prev.draw !== draw) painters.current[i]?.(draw);
    });
  });

  /** Tab (or a screen reader's focus) on a beat brings the story to it, so what has the focus is on screen. */
  const bringIn = (i: number) => {
    const vh = store.frames.intro.t * INTRO_VH;
    if (store.getCoarse().current !== "intro" || proofBeatState(vh, i).shown > 0.99) return;
    const [a, b] = proofBeatSpan(i);
    const span = store.rail.spans[0];
    const y = span.start + ((span.end - span.start) * (a + (b - a) * HOLD_AT)) / INTRO_VH;
    store.jump(y);
    scrollToY(y, false);
  };

  return (
    <div className="intro-pbeats">
      {BEATS.map((b, i) => (
        <section
          key={b.key}
          ref={(el) => (roots.current[i] = el)}
          className="intro-pbeat"
          data-beat={b.key}
          data-shown="false"
          aria-labelledby={`${id}-${i}-k ${id}-${i}-h`}
          tabIndex={0}
          onFocus={() => bringIn(i)}
          style={{ opacity: 0 }}
        >
          <div className="intro-pbeat__panel">
            <header className="intro-pbeat__head-block">
              <p id={`${id}-${i}-k`} className="intro-pbeat__kicker world-u">
                {b.kicker}
              </p>
              <h2 id={`${id}-${i}-h`} className="intro-pbeat__head">
                {b.head.map((line, j) => [
                  j > 0 ? " " : null,
                  <span key={j} className="intro-pbeat__line">
                    {line}
                  </span>,
                ])}
              </h2>
            </header>
            <b.Graph register={registers.current[i]} />
          </div>
        </section>
      ))}
    </div>
  );
}
