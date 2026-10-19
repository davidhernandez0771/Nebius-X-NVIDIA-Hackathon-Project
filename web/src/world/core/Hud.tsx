// The HUD (backtick, or ?hud) and the quality chip, bottom right: the tier and fps; a click steps
// the tier (low → high → ultra) and saves it. The numbers come from the canvas (hud.ts).
import { useEffect, useRef, useState } from "react";
import { hud } from "./hud";
import type { QualityTier, TierName } from "./quality";
import type { WorldStore } from "./store";

const NEXT: Record<TierName, TierName> = { low: "high", high: "ultra", ultra: "low" };

export function Hud({ store, quality, forced, onTier }: { store: WorldStore; quality: QualityTier; forced: boolean; onTier: (t: TierName) => void }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has("hud"));
  const pre = useRef<HTMLPreElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === "`") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const paint = () => {
      if (chip.current) chip.current.textContent = `${quality.name} · ${hud.fps || "—"} fps`;
      if (!open || !pre.current) return;
      const c = store.getCoarse();
      const particles = quality.logoParticles + quality.dustParticles;
      pre.current.textContent = [
        `tier      ${quality.name}${forced ? " (url)" : ""}${hud.tune ? `  ${hud.tune}` : ""}`,
        `fps       ${hud.fps}`,
        `dpr       ${hud.dpr}`,
        `calls     ${hud.calls}`,
        `tris      ${hud.tris}`,
        `points    ${hud.points}`,
        `particles ${particles}`,
        `post      ${quality.post ? `bloom ½ + final, msaa ${quality.msaa}x` : "none"}`,
        `textures  ${hud.textures}`,
        `geometry  ${hud.geometries}`,
        `programs  ${hud.programs}`,
        `heap      ${hud.heapMb === null ? "n/a" : `${hud.heapMb} MB`}`,
        `gpu       ${hud.gpu.slice(0, 46)}`,
        `at        ${c.branch ?? c.current}  y ${(store.shownY / window.innerHeight).toFixed(2)} vh`,
      ].join("\n");
    };
    paint();
    const id = window.setInterval(paint, 250);
    return () => window.clearInterval(id);
  }, [open, quality, forced, store]);

  return (
    <>
      <button ref={chip} type="button" className="world-q world-u" title="Quality tier (click to change)" onClick={() => onTier(NEXT[quality.name])}>
        {quality.name}
      </button>
      {open ? <pre ref={pre} className="world-hud" aria-label="Performance HUD" /> : null}
    </>
  );
}
