import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { formatStat } from "../motion/format";
import { useMotion } from "../motion/MotionProvider";

export type Arm = { label: string; k: number; n: number; ciLow: number; ciHigh: number };

/**
 * Success rates as bars with their 95% CI. Bars grow once, at the same speed, with an ease-out
 * that never passes the measured rate; the CI whiskers appear after. The same data is repeated
 * in a visually hidden table.
 */
export function ResultBars({ arms, p }: { arms: Arm[]; p: string }) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [grown, setGrown] = useState(true);

  useLayoutEffect(() => {
    if (reduced || typeof IntersectionObserver !== "function" || !ref.current) {
      setGrown(true);
      return;
    }
    setGrown(false);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setGrown(true);
      },
      { threshold: 0.5 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div ref={ref} className="sant-bars" data-grown={grown}>
      {arms.map((a, i) => (
        <div key={a.label} className="sant-bars__row" aria-hidden="true">
          <span className="sant-bars__label">{a.label}</span>
          <span className="sant-bars__track">
            <span className="sant-bars__bar" data-series={i} style={{ "--sant-bar": String(a.k / a.n) } as CSSProperties} />
            <span className="sant-bars__ci" style={{ "--lo": String(a.ciLow / 100), "--hi": String(a.ciHigh / 100) } as CSSProperties} />
          </span>
          <span className="sant-bars__value">
            <span className="sant-num">
              {a.k}/{a.n}
            </span>{" "}
            <span className="sant-bars__pct sant-num">{formatStat((100 * a.k) / a.n, 1)}%</span>
          </span>
        </div>
      ))}
      <p className="sant-bars__p">Fisher exact p = {p}</p>
      <div className="sant-sr-only">
        <table>
          <caption>Success rate per arm, with 95% confidence interval</caption>
          <thead>
            <tr>
              <th scope="col">Training data</th>
              <th scope="col">Successes</th>
              <th scope="col">Rate</th>
              <th scope="col">95% CI</th>
            </tr>
          </thead>
          <tbody>
            {arms.map((a) => (
              <tr key={a.label}>
                <th scope="row">{a.label}</th>
                <td>
                  {a.k} of {a.n}
                </td>
                <td>{formatStat((100 * a.k) / a.n, 1)}%</td>
                <td>
                  {formatStat(a.ciLow, 1)}–{formatStat(a.ciHigh, 1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
