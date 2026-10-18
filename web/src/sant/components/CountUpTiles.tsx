import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatStat } from "../motion/format";
import { useMotion } from "../motion/MotionProvider";
import { odometer, placesFor } from "../motion/odometer";
import { countUp } from "../motion/presets";

const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/**
 * A measured change shown as digit tiles that roll like an odometer, e.g. 7.5% → 42.5%. The count
 * runs once, the first time it is seen, with the same ease-out as Stat, so every frame shows a
 * value between the two measurements. Assistive tech gets the final value as the group's name.
 */
export function CountUpTiles({
  from,
  to,
  decimals = 0,
  suffix = "",
  label,
  note,
  source,
}: {
  from: number;
  to: number;
  decimals?: number;
  suffix?: string;
  label: string;
  note?: ReactNode;
  source?: string;
}) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(to);
  const places = placesFor(from, to, decimals);

  useLayoutEffect(() => {
    if (reduced || typeof IntersectionObserver !== "function" || !ref.current) {
      setValue(to);
      return;
    }
    setValue(from);
    let stop = () => {};
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        stop = countUp({ from, to, reduced, onUpdate: setValue });
      },
      { threshold: 0.6 },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      stop();
    };
  }, [from, to, reduced]);

  const cells = odometer(value, places);
  return (
    <div ref={ref} className="sant-tiles" role="group" aria-label={`${formatStat(to, decimals)}${suffix} ${label}`}>
      <div className="sant-tiles__row" aria-hidden="true">
        {cells.map((c) => (
          <span key={c.place} className="sant-tiles__group">
            {c.place === -1 && <span className="sant-tiles__point">.</span>}
            <span
              className="sant-tiles__tile"
              data-pos={String(Math.round(c.pos * 1000) / 1000)}
              data-lead={c.lead}
              style={{ "--pos": c.pos } as CSSProperties}
            >
              <span className="sant-tiles__strip">
                {STRIP.map((d, i) => (
                  <span key={i} className="sant-tiles__digit">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          </span>
        ))}
        {suffix && <span className="sant-tiles__suffix">{suffix}</span>}
      </div>
      <span className="sant-tiles__label" aria-hidden="true">
        {label}
      </span>
      {note && <span className="sant-tiles__note">{note}</span>}
      {source && <span className="sant-tiles__source">Source: {source}</span>}
    </div>
  );
}
