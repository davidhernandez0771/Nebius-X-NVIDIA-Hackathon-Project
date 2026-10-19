// The story beats: big mono headlines over the canvas, each shown over a span of its station's dwell
// and revealed with the scramble. They follow the scroll through useStationFrame (no React state per
// frame). The old beat leaves fast and the new one waits for it, so two headlines never overlap (CSS).
import { useRef, type ReactNode } from "react";
import { useStationFrame, useWorld } from "../core/WorldContext";
import type { StationId } from "../core/types";
import { scramble } from "./scramble";
import "./ui.css";

export interface Beat {
  /** The span of the station's dwell t where it shows: [from, to). */
  from: number;
  to: number;
  className?: string;
  children: ReactNode;
}

export function Beats({ station, beats }: { station: StationId; beats: Beat[] }) {
  const { store, reduced } = useWorld();
  const els = useRef<(HTMLElement | null)[]>([]);
  const on = useRef<boolean[]>([]);
  useStationFrame(station, (f) => {
    const ready = store.getCoarse().ready && !store.getCoarse().branch;
    beats.forEach((b, i) => {
      const el = els.current[i];
      if (!el) return;
      const now = ready && f.arrive >= 1 && f.t >= b.from && f.t < b.to;
      if (now === !!on.current[i]) return;
      on.current[i] = now;
      el.dataset.on = String(now);
      el.querySelectorAll<HTMLElement>("[data-scramble]").forEach((t) => {
        const final = (t.dataset.final ??= t.textContent ?? "");
        if (now) window.setTimeout(() => on.current[i] && scramble(t, final, { reduced }), reduced ? 0 : 200);
        else t.textContent = final;
      });
    });
  });
  return (
    <>
      {beats.map((b, i) => (
        <section key={i} ref={(el) => (els.current[i] = el)} className={`world-beat ${b.className ?? ""}`} data-on="false">
          {b.children}
        </section>
      ))}
    </>
  );
}
