// The proof band on the Results page: the pre-registered Isaac Lab results as four charts and a list, in the holo
// look of the work pages (Holo.tsx: see-through panels with corner ticks, mono tags, teal for the one result that
// matters, amber for what failed). Every number is from ./proofData.ts. Each chart is a <figure> named by its title,
// described by a sentence (aria-describedby) and backed by a data table; the drawing itself is aria-hidden.
// Motion: the climb's bars grow once when first seen; nothing moves with reduced motion.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMotion } from "../../sant/motion/MotionProvider";
import { formatStat } from "../../sant/motion/format";
import { HoloPanel, HoloTag } from "../holo/Holo";
import {
  CLIMB,
  CLIMB_FOOTNOTE,
  CLIMB_FOOTNOTE_SOURCE,
  DID_NOT_WORK,
  GOAL,
  TEACHER,
  V2_FAILURES,
  proofCite,
  proofNoteUrl,
  type ProofSource,
  type Rate,
} from "./proofData";
import "./proof.css";

export const PROOF_TITLE = "The proof: pre-registered, each run once";

const pct = (k: number, n: number) => `${formatStat((100 * k) / n, 1)}%`;
const ciText = ([lo, hi]: [number, number]) => `${formatStat(100 * lo, 1)}–${formatStat(100 * hi, 1)}%`;
const at = (x: number) => `${x * 100}%`;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** A note and its lines, as a link, in the same markup as the page's other citations (Cite.tsx). */
export function ProofCite({ source, prefix = "Source: " }: { source: ProofSource; prefix?: string }) {
  return (
    <cite className="sant-cite">
      {prefix}
      <a href={proofNoteUrl(source)} target="_blank" rel="noreferrer">
        {proofCite(source)}
      </a>
    </cite>
  );
}

/** True once the element has been seen (at once with reduced motion or no IntersectionObserver). */
function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { reduced } = useMotion();
  const [seen, setSeen] = useState(true);
  useLayoutEffect(() => {
    if (reduced || typeof IntersectionObserver !== "function" || !ref.current) {
      setSeen(true);
      return;
    }
    setSeen(false);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setSeen(true);
      },
      { threshold: 0.4 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced]);
  return { ref, seen };
}

/** A chart: named by its title, described by a sentence, with the drawing, a data table and a caption. */
function ProofFigure({ title, summary, children, caption }: { title: string; summary: ReactNode; children: ReactNode; caption: ReactNode }) {
  const id = useId();
  return (
    <HoloPanel as="figure" className="sant-proof__figure" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <p id={`${id}-t`} className="sant-proof__figure-title">
        {title}
      </p>
      <p id={`${id}-d`} className="sant-proof__summary">
        {summary}
      </p>
      {children}
      <figcaption className="sant-proof__caption">{caption}</figcaption>
    </HoloPanel>
  );
}

/** A sub-section of the band: a mono index, the heading and what it asks. */
function Part({ index, id, title, lede, children }: { index: string; id: string; title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <section className="sant-proof__part" aria-labelledby={id}>
      <header className="sant-proof__part-head">
        <HoloTag aria-hidden="true" className="sant-proof__index">
          {index}
        </HoloTag>
        <h3 id={id} className="sant-proof__h3">
          {title}
        </h3>
        <p className="sant-proof__lede">{lede}</p>
      </header>
      {children}
    </section>
  );
}

/** The 0–100% axis under a horizontal plot. */
function Axis() {
  return (
    <div className="sant-proof__axis" aria-hidden="true">
      {TICKS.map((t) => (
        <span key={t} className="sant-num" style={{ left: at(t) }}>
          {t * 100}%
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ 1. the climb

function Climb() {
  const { ref, seen } = useSeen<HTMLDivElement>();
  const v2 = CLIMB[CLIMB.length - 1];
  const goal = GOAL.k / GOAL.n;
  return (
    <Part
      index="01"
      id="proof-climb"
      title="The climb: from 0/40 to 30/40"
      lede="Four recipes, one 40-scene test each. A camera policy (ACT) drives a Franka arm to put a cube in a bin, in Isaac Lab, on scenes it has never seen."
    >
      <ProofFigure
        title="Success on the 40-scene one-shot test"
        summary={
          <>
            Raw mouse demos {CLIMB[0].k}/{CLIMB[0].n}, SANT-perfected and multiplied {CLIMB[1].k}/{CLIMB[1].n}, the RL teacher distilled in (v1){" "}
            {CLIMB[2].k}/{CLIMB[2].n}, and v2 {v2.k}/{v2.n}: the only one past the goal of {GOAL.k}/{GOAL.n}.
          </>
        }
        caption={
          <>
            <span className="sant-proof__footnote">{CLIMB_FOOTNOTE}</span> Bars are the success rate; the line under each is its Wilson 95%
            interval.
            {CLIMB.map((s) => (
              <ProofCite key={s.key} source={s.source} prefix={`${s.tag}: `} />
            ))}
            <ProofCite source={GOAL.source} prefix="Goal: " />
            <ProofCite source={CLIMB_FOOTNOTE_SOURCE} prefix="Seeds: " />
          </>
        }
      >
        <div
          ref={ref}
          className="sant-proof__plot"
          data-testid="climb-plot"
          data-grown={seen}
          aria-hidden="true"
          style={{ "--goal": at(goal) } as CSSProperties}
        >
          <div className="sant-proof__field">
            <span className="sant-proof__goal" style={{ left: at(goal) }}>
              <span className="sant-proof__goal-label sant-num">
                Goal {formatStat(100 * goal, 0)}% ({GOAL.k}/{GOAL.n})
              </span>
            </span>
            {CLIMB.map((s, i) => (
              <div key={s.key} className="sant-proof__row" data-step={s.key} style={{ "--i": i } as CSSProperties}>
                <div className="sant-proof__row-head">
                  <span className="sant-proof__tag sant-num">{s.tag}</span>
                  <span className="sant-proof__label">{s.label}</span>
                  <span className="sant-proof__value">
                    <span className="sant-num sant-proof__count">
                      {s.k}/{s.n}
                    </span>
                    <span className="sant-num sant-proof__ci">CI {ciText(s.ci)}</span>
                  </span>
                </div>
                <div className="sant-proof__track">
                  <span className="sant-proof__bar" style={{ "--v": String(s.k / s.n) } as CSSProperties} />
                  <span className="sant-proof__whisker" style={{ left: at(s.ci[0]), right: at(1 - s.ci[1]) }} />
                </div>
              </div>
            ))}
          </div>
          <Axis />
        </div>
        <div className="sant-sr-only">
          <table>
            <caption>Success on the 40-scene one-shot test, with Wilson 95% intervals. Goal: {GOAL.k}/{GOAL.n}.</caption>
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
        </div>
      </ProofFigure>
    </Part>
  );
}

// ------------------------------------------------------------------ 2. the teacher side

const FIRST = TEACHER.curve[0].iteration;
const LAST = TEACHER.curve[TEACHER.curve.length - 1].iteration;
const xAt = (it: number) => (it - FIRST) / (LAST - FIRST);
const yAt = (k: number) => 1 - k / TEACHER.n;

function FinalLedger({ label, rate, series }: { label: string; rate: Rate; series: "with" | "without" }) {
  return (
    <div className="sant-proof__final" data-series={series}>
      <dt>
        <span className="sant-proof__key" aria-hidden="true" />
        {label}
      </dt>
      <dd>
        <span className="sant-num sant-proof__count">
          {rate.k}/{rate.n}
        </span>{" "}
        <span className="sant-num">{pct(rate.k, rate.n)}</span>, Wilson 95% CI <span className="sant-num">{ciText(rate.ci)}</span>
      </dd>
    </div>
  );
}

function Teacher() {
  const [active, setActive] = useState(TEACHER.curve.length - 1);
  const p = TEACHER.curve[active];
  const line = (pick: (c: (typeof TEACHER.curve)[number]) => number) =>
    TEACHER.curve.map((c) => `${100 * xAt(c.iteration)},${100 * yAt(pick(c))}`).join(" ");
  const { withDemos, withoutDemos } = TEACHER.final;
  const lastX = at(xAt(LAST));
  return (
    <Part
      index="02"
      id="proof-teacher"
      title="Did the human demos matter? The teacher side"
      lede="The RL teacher behind v1 and v2 was trained twice: once with episodes that start partway through a human demo, once from the robot's home pose only. Both were then tested from home, on the same 128 scenes."
    >
      <ProofFigure
        title="Home-start success out of 128, by RL training iteration"
        summary={
          <>
            With human demo starts the teacher reached {TEACHER.curve.map((c) => c.withDemos).join(", ")} of {TEACHER.n} at iterations{" "}
            {TEACHER.curve.map((c) => c.iteration).join(", ")}. Without them it stayed at 0/{TEACHER.n} at every checkpoint.
          </>
        }
        caption={
          <>
            {TEACHER.caption} PPO, 4096 environments, 1500 iterations.
            <ProofCite source={TEACHER.source} prefix="Curve: " />
            <ProofCite source={TEACHER.finalSource} prefix="Final: " />
            <ProofCite source={TEACHER.setupSource} prefix="Setup: " />
          </>
        }
      >
        <ul className="sant-proof__legend" aria-hidden="true">
          <li data-series="with">
            <span className="sant-proof__key" />
            With human demo starts
          </li>
          <li data-series="without">
            <span className="sant-proof__key" />
            Without (home starts only)
          </li>
        </ul>
        <div className="sant-proof__curve">
          <div className="sant-proof__yaxis" aria-hidden="true">
            {TICKS.map((t) => (
              <span key={t} className="sant-num" style={{ top: at(1 - t) }}>
                {t * 100}%
              </span>
            ))}
          </div>
          <div className="sant-proof__cfield">
            <div className="sant-proof__cplot" aria-hidden="true">
              {TICKS.map((t) => (
                <span key={t} className="sant-proof__grid" style={{ top: at(1 - t) }} />
              ))}
              <span className="sant-proof__cross" style={{ left: at(xAt(p.iteration)) }} />
              <svg className="sant-proof__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline data-series="without" points={line((c) => c.withoutDemos)} vectorEffect="non-scaling-stroke" />
                <polyline data-series="with" points={line((c) => c.withDemos)} vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="sant-proof__vci" data-series="with" style={{ left: lastX, top: at(1 - withDemos.ci[1]), bottom: at(withDemos.ci[0]) }} />
              <span className="sant-proof__vci" data-series="without" style={{ left: lastX, top: at(1 - withoutDemos.ci[1]), bottom: at(withoutDemos.ci[0]) }} />
              {TEACHER.curve.map((c, i) => (
                <span key={c.iteration}>
                  <span className="sant-proof__dot" data-series="without" data-on={i === active} style={{ left: at(xAt(c.iteration)), top: at(yAt(c.withoutDemos)) }} />
                  <span className="sant-proof__dot" data-series="with" data-on={i === active} style={{ left: at(xAt(c.iteration)), top: at(yAt(c.withDemos)) }} />
                </span>
              ))}
              <span className="sant-proof__end sant-num" data-series="with" style={{ top: at(yAt(withDemos.k)) }}>
                {withDemos.k}/{withDemos.n}
              </span>
              <span className="sant-proof__end sant-num" data-series="without" style={{ top: at(yAt(withoutDemos.k)) }}>
                {withoutDemos.k}/{withoutDemos.n}
              </span>
            </div>
            <div className="sant-proof__hits" role="group" aria-label="Checkpoints">
              {TEACHER.curve.map((c, i) => (
                <button
                  key={c.iteration}
                  type="button"
                  className="sant-proof__hit"
                  style={{ left: at(xAt(c.iteration)) }}
                  aria-label={`Iteration ${c.iteration}: with human demo starts ${c.withDemos}/${TEACHER.n}, without ${c.withoutDemos}/${TEACHER.n}`}
                  aria-pressed={i === active}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
            <div className="sant-proof__xaxis" aria-hidden="true">
              {TEACHER.curve.map((c) => (
                <span key={c.iteration} className="sant-num" style={{ left: at(xAt(c.iteration)) }}>
                  {c.iteration}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="sant-proof__readout" data-testid="curve-readout" aria-hidden="true">
          <span className="sant-num">Iteration {p.iteration}</span>
          <span data-series="with">
            with demo starts <span className="sant-num">{p.withDemos}/{TEACHER.n}</span>
          </span>
          <span data-series="without">
            without <span className="sant-num">{p.withoutDemos}/{TEACHER.n}</span>
          </span>
        </p>
        <dl className="sant-proof__finals">
          <FinalLedger label="With human demo starts, iteration 1499" rate={withDemos} series="with" />
          <FinalLedger label="Without, iteration 1499" rate={withoutDemos} series="without" />
        </dl>
        <div className="sant-sr-only">
          <table>
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
        </div>
      </ProofFigure>
    </Part>
  );
}

// ------------------------------------------------------------------ 3. why v2's failures failed

function Failures() {
  const { total, timedOut, timeLimitS, reasons, failedSeeds } = V2_FAILURES;
  const v2 = CLIMB[CLIMB.length - 1];
  const first = 5400;
  const seeds = Array.from({ length: v2.n }, (_, i) => first + i);
  const failed = new Set(failedSeeds);
  return (
    <Part
      index="03"
      id="proof-failures"
      title="Why the 10 v2 test failures failed"
      lede={
        <>
          v2 put the cube in the bin in {v2.k} of the {v2.n} test scenes. In the other {total}, the robot was still trying when the clock ran out.
        </>
      }
    >
      <ProofFigure
        title="Why each of the 10 failed scenes failed"
        summary={
          <>
            Of the {total} failed scenes: {reasons.map((r) => `${r.label.toLowerCase()} ${r.count}`).join(", ")}. One failure can have several
            reasons, so the counts add up to more than {total}. All {timedOut} ran out the {timeLimitS} s time limit.
          </>
        }
        caption={
          <>
            One failure can have several reasons. Failed seeds: <span className="sant-num sant-proof__seedlist">{failedSeeds.join(", ")}</span>.
            <ProofCite source={V2_FAILURES.source} />
            <ProofCite source={V2_FAILURES.timeLimitSource} prefix="Time limit: " />
          </>
        }
      >
        <div className="sant-proof__seeds" aria-hidden="true">
          <ol className="sant-proof__tally">
            {seeds.map((s) => (
              <li key={s} data-state={failed.has(s) ? "failure" : "success"} title={`Seed ${s}: ${failed.has(s) ? "failed" : "in the bin"}`} />
            ))}
          </ol>
          <p className="sant-proof__tally-key">
            <span data-state="success" /> in the bin <span className="sant-num">{v2.k}</span>
            <span data-state="failure" /> failed <span className="sant-num">{total}</span>
            <span className="sant-proof__tally-seeds sant-num">seeds 5400–5439</span>
          </p>
        </div>
        <div className="sant-proof__plot sant-proof__plot--reasons" aria-hidden="true">
          <div className="sant-proof__field">
            {reasons.map((r) => (
              <div key={r.key} className="sant-proof__row" data-reason={r.key}>
                <div className="sant-proof__row-head">
                  <span className="sant-proof__label">{r.label}</span>
                  <span className="sant-proof__value">
                    <span className="sant-num sant-proof__count">{r.count}</span>
                    <span className="sant-num sant-proof__ci">of {total}</span>
                  </span>
                </div>
                <div className="sant-proof__track">
                  <span className="sant-proof__bar" style={{ "--v": String(r.count / total) } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="sant-proof__timeout">
          <HoloTag dot>Time limit</HoloTag>
          <span>
            All {timedOut} ran out the {timeLimitS} s time limit.
          </span>
        </p>
        <div className="sant-sr-only">
          <table>
            <caption>Failure reasons in the {total} failed v2 test scenes; one failure can have several</caption>
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">Failed scenes with it</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ProofFigure>
    </Part>
  );
}

// ------------------------------------------------------------------ 4. what didn't work

function Setbacks() {
  return (
    <Part
      index="04"
      id="proof-setbacks"
      title="What didn't work"
      lede="Three things we tried that failed, published with the rest. Each was caught by a check or a rule written down before the run."
    >
      <ul className="sant-proof__setbacks">
        {DID_NOT_WORK.map((d) => (
          <HoloPanel as="li" key={d.key} state="fail" className="sant-proof__setback">
            <p className="sant-proof__setback-figure sant-num">{d.figure}</p>
            <p className="sant-proof__setback-title">{d.title}</p>
            <p className="sant-proof__setback-text">{d.text}</p>
            {d.sources.map((s, i) => (
              <ProofCite key={i} source={s} prefix={i === 0 ? "Source: " : ""} />
            ))}
          </HoloPanel>
        ))}
      </ul>
    </Part>
  );
}

export function ProofSection() {
  return (
    <section className="holo sant-proof" data-mode="volt" aria-labelledby="results-proof">
      <header className="sant-proof__head">
        <HoloTag dot>Isaac Lab · Franka · cube in bin</HoloTag>
        <h2 id="results-proof" className="sant-proof__title">
          {PROOF_TITLE}
        </h2>
        <p className="sant-proof__intro">
          The newest results, starting from a person's mouse demos. Each test below was written down before it ran, with its seeds, its
          pick rule and its goal, and then run once.
        </p>
      </header>
      <Climb />
      <Teacher />
      <Failures />
      <Setbacks />
    </section>
  );
}
