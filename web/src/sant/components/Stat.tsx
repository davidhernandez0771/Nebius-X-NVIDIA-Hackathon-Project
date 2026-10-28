import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatStat } from "../motion/format";
import { useMotion } from "../motion/MotionProvider";
import { countUp } from "../motion/presets";

type Props = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  note?: ReactNode;
  source?: string;
};

/**
 * A measured number that counts up once, the first time it is seen. Assistive tech gets the
 * final value as the group's name; the moving digits are hidden from it.
 */
export function Stat({ value, decimals = 0, prefix = "", suffix = "", label, note, source }: Props) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const text = (v: number) => `${prefix}${formatStat(v, decimals)}${suffix}`;
  const final = text(value);
  const [shown, setShown] = useState(final);

  useLayoutEffect(() => {
    if (reduced || typeof IntersectionObserver !== "function" || !ref.current) {
      setShown(final);
      return;
    }
    setShown(text(0));
    let stop = () => {};
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        stop = countUp({ to: value, reduced, onUpdate: (v) => setShown(text(v)) });
      },
      { threshold: 0.6 },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      stop();
    };
    // text() only depends on the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, prefix, suffix, reduced, final]);

  return (
    <div ref={ref} className="sant-stat" role="group" aria-label={`${final} ${label}`}>
      <span className="sant-stat__value" aria-hidden="true">
        {shown}
      </span>
      <span className="sant-stat__label" aria-hidden="true">
        {label}
      </span>
      {note && <span className="sant-stat__note">{note}</span>}
      {source && <span className="sant-stat__source">Source: {source}</span>}
    </div>
  );
}
