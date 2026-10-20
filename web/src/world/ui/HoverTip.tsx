// The tip by the cursor while it points at a cartridge: its title, scrambled in, and what a click does.
import { useEffect, useRef } from "react";
import { useWorld } from "../core/WorldContext";
import { spiral, subscribeSpiral } from "../scene/spiral";
import { scramble } from "./scramble";
import "./ui.css";

export function HoverTip() {
  const { reduced } = useWorld();
  const tip = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = -1;
    // The labels live with the spiral's 3D (Helix), which loads after the first frame; by the time a
    // cartridge can be pointed at, it's there.
    const labels = import("../scene/Helix").then((m) => m.instanceLabel);
    const move = (e: PointerEvent) => {
      if (!tip.current) return;
      // Right of the cursor, or left of it where the tip would run off the screen's right edge.
      const w = tip.current.offsetWidth;
      const x = e.clientX + 16 + w > window.innerWidth ? e.clientX - 16 - w : e.clientX + 16;
      tip.current.style.transform = `translate(${Math.max(0, x)}px, ${e.clientY + 14}px)`;
    };
    const off = subscribeSpiral(() => {
      const k = spiral.selected >= 0 ? -1 : spiral.hover;
      if (k === shown || !tip.current || !title.current) return;
      shown = k;
      tip.current.dataset.on = String(k >= 0);
      if (k >= 0)
        labels.then((label) => {
          if (shown === k && title.current) scramble(title.current, label(k), { duration: 380, reduced });
        });
    });
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      off();
      window.removeEventListener("pointermove", move);
    };
  }, [reduced]);
  return (
    <div ref={tip} className="world-tip world-u" data-on="false" aria-hidden="true">
      <span ref={title} /> <em>· click to open</em>
    </div>
  );
}
