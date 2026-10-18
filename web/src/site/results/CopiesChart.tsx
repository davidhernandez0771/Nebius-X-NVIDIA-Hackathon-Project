import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "../../sant/components/Button";
import { useMotion } from "../../sant/motion/MotionProvider";
import { formatStat } from "../../sant/motion/format";
import { ARMS } from "./facts";
import { replay } from "./stats";

/** One scene every STEP_MS: the three 40-scene runs replay in about 2.2 s. */
const STEP_MS = 55;
const TOTAL = ARMS[0].outcomes.length;
const GRID = [0, 0.25, 0.5, 0.75, 1];

/**
 * Replays the evals scene by scene, in the order they ran. The count starts the first time the
 * chart is seen, and the Replay button restarts it. With motion reduced (or no
 * IntersectionObserver) the finished run is shown at once.
 */
function useReplay(ref: React.RefObject<HTMLElement>) {
  const { reduced } = useMotion();
  const [n, setN] = useState(TOTAL);
  const [playing, setPlaying] = useState(false);

  useLayoutEffect(() => {
    setPlaying(false);
    if (reduced || typeof IntersectionObserver !== "function" || !ref.current) {
      setN(TOTAL);
      return;
    }
    setN(0);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setPlaying(true);
      },
      { threshold: 0.35 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced, ref]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setN((v) => Math.min(TOTAL, v + 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (playing && n >= TOTAL) setPlaying(false);
  }, [n, playing]);

  const restart = () => {
    setN(0);
    setPlaying(true);
  };
  return { n, done: n >= TOTAL, reduced, restart };
}

const y = (rate: number) => `${(1 - rate) * 100}%`;

export function CopiesChart() {
  const ref = useRef<HTMLDivElement>(null);
  const { n, done, reduced, restart } = useReplay(ref);
  const runs = useMemo(() => ARMS.map((a) => replay(a.outcomes)), []);
  const now = runs.map((frames) => frames[n]);
  const line = now
    .map((f, i) => (f.rate === null ? null : `${100 * i + 50},${(1 - f.rate) * 100}`))
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className="sant-copies">
      <div className="sant-copies__bar">
        <p className="sant-copies__progress" aria-hidden="true">
          <span data-testid="replay-progress">
            <span className="sant-num">{n}</span> of <span className="sant-num">{TOTAL}</span> scenes
          </span>
        </p>
        {!reduced && (
          <Button variant="secondary" size="sm" onClick={restart} disabled={!done}>
            Replay the runs
          </Button>
        )}
      </div>

      <div className="sant-copies__plot" aria-hidden="true">
        <div className="sant-copies__axis">
          {GRID.map((g) => (
            <span key={g} className="sant-copies__tick sant-num" style={{ top: y(g) }}>
              {g * 100}%
            </span>
          ))}
        </div>
        <div className="sant-copies__field">
          {GRID.map((g) => (
            <span key={g} className="sant-copies__grid" style={{ top: y(g) }} />
          ))}
          <svg className="sant-copies__line" viewBox="0 0 300 100" preserveAspectRatio="none">
            {line && <polyline points={line} vectorEffect="non-scaling-stroke" />}
          </svg>
          {ARMS.map((a, i) => {
            const f = now[i];
            return (
              <div key={a.key} className="sant-copies__col" data-arm={a.key}>
                {f.rate !== null && (
                  <>
                    <span className="sant-copies__ci" style={{ top: y(f.hi), bottom: `${f.lo * 100}%` }} />
                    <span className="sant-copies__dot" style={{ top: y(f.rate) }} />
                    <span className="sant-copies__value sant-num" style={{ top: y(f.rate) }}>
                      {f.k}/{f.n}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sant-copies__keys">
        {ARMS.map((a) => (
          <div key={a.key} className="sant-copies__key" data-arm={a.key}>
            <p className="sant-copies__copies">
              <span className="sant-num">{a.copies}</span> copies
            </p>
            <p className="sant-copies__label">{a.label}</p>
            <ol className="sant-copies__tally" aria-hidden="true">
              {[...a.outcomes].map((c, s) => (
                <li
                  key={s}
                  className="sant-copies__scene"
                  data-state={s >= n ? "waiting" : c === "1" ? "success" : "failure"}
                  data-latest={s === n - 1 && !done}
                  style={{ "--s": s } as CSSProperties}
                />
              ))}
            </ol>
            <p className="sant-copies__final" data-shown={done}>
              {formatStat((100 * a.k) / a.n, 1)}%, 95% CI <span className="sant-num">{a.ci.text}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="sant-sr-only">
        <table>
          <caption>Success on the same 40 new scenes, by number of verified copies</caption>
          <thead>
            <tr>
              <th scope="col">Training data</th>
              <th scope="col">Successes</th>
              <th scope="col">Rate</th>
              <th scope="col">95% CI</th>
              <th scope="col">Training passes over each example</th>
            </tr>
          </thead>
          <tbody>
            {ARMS.map((a) => (
              <tr key={a.key}>
                <th scope="row">
                  {a.copies} copies ({a.label})
                </th>
                <td>
                  {a.k} of {a.n}
                </td>
                <td>{formatStat((100 * a.k) / a.n, 1)}%</td>
                <td>{a.ci.text}</td>
                <td>{a.epochs.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
