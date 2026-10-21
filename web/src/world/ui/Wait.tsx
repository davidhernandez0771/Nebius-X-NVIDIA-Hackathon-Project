// Scrolled (or jumped) ahead of what has arrived: a brief "loading" in place, with the real bytes, instead
// of an empty scene. What the visitor waits on where they are comes from core/waiting.ts; its files jump to
// the front of the background queue (core/assets.ts). It shows only after a beat, so a quick arrival never
// flashes, and lifts once the files are in and the scene stands (core/standing.ts).
import { useEffect, useState } from "react";
import type { Assets } from "../core/assets";
import type { TierName } from "../core/quality";
import { subscribeStanding } from "../core/standing";
import type { WorldStore } from "../core/store";
import { waitFor } from "../core/waiting";
import { INTRO_VH } from "../stations/intro/storyPlan";

/** How long something must still be coming before the state shows. */
export const SHOW_AFTER_MS = 250;

interface Waiting {
  label: string;
  loaded: number;
  total: number;
}

const mb = (b: number) => (b / 1e6).toFixed(1);
/** The default: the files alone (one function for every render, so the effect below doesn't re-run). */
const FILES_ONLY = () => true;

export function Wait({
  store,
  assets,
  tier,
  reduced,
  stands = FILES_ONLY,
}: {
  store: WorldStore;
  assets: Assets;
  tier: TierName;
  reduced: boolean;
  /** Whether the scene for a station (or "intro:places") stands; the files alone by default. */
  stands?: (key: string) => boolean;
}) {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let last = "";
    let asked = "";
    const compute = () => {
      const c = store.getCoarse();
      const id = c.branch ?? c.current;
      const w = c.ready ? waitFor(id, store.frames.intro.t * INTRO_VH, tier, reduced) : null;
      let next: Waiting | null = null;
      if (w && w.files.length) {
        const p = assets.progress(w.files);
        const key = id === "intro" ? "intro:places" : id;
        if (!p.done || !stands(key)) {
          next = { label: w.label, loaded: p.loaded, total: p.total };
          // The visitor is here now: these files first.
          if (asked !== w.label) {
            asked = w.label;
            assets.prioritize(w.files);
          }
        }
      }
      const sig = next ? `${next.label}|${next.loaded}|${next.total}` : "";
      if (sig === last) return;
      last = sig;
      setWaiting(next);
    };
    compute();
    const offs = [store.subscribe(compute), store.onFrame(compute), assets.subscribe(compute), subscribeStanding(compute)];
    return () => offs.forEach((off) => off());
  }, [store, assets, tier, reduced, stands]);

  // After a beat, so a quick arrival never flashes; gone at once when it is in.
  const on = waiting !== null;
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [on]);

  const show = shown && waiting;
  const share = show && waiting.total ? waiting.loaded / waiting.total : 0;
  return (
    <div className="world-wait" data-on={Boolean(show)} role="status" aria-live="polite">
      {show ? (
        <>
          <span className="world-wait__label">Loading {waiting.label}</span>
          <span className="world-wait__bytes">
            {mb(waiting.loaded)} / {mb(waiting.total)} MB
          </span>
          <i className="world-wait__bar" aria-hidden="true">
            <b style={{ transform: `scaleX(${share})` }} />
          </i>
        </>
      ) : null}
    </div>
  );
}
