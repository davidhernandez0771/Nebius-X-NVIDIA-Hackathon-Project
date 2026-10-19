// The tip by the cursor while it points at a cartridge: its title, scrambled in, and what a click does.
import { useEffect, useRef } from "react";
import { useWorld } from "../core/WorldContext";
import { instanceLabel } from "../scene/Helix";
import { spiral, subscribeSpiral } from "../scene/spiral";
import { scramble } from "./scramble";
import "./ui.css";

export function HoverTip() {
  const { reduced } = useWorld();
  const tip = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = -1;
    const move = (e: PointerEvent) => {
      if (!tip.current) return;
      tip.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
    };
    const off = subscribeSpiral(() => {
      const k = spiral.selected >= 0 ? -1 : spiral.hover;
      if (k === shown || !tip.current || !title.current) return;
      shown = k;
      tip.current.dataset.on = String(k >= 0);
      if (k >= 0) scramble(title.current, instanceLabel(k), { duration: 380, reduced });
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
