// The detail view's DOM: "Scroll to close" at the top, and the info block bottom left with the
// title scrambled in, "2026 / robot / tag", the one honest sentence, Plug in and Close. It takes focus
// when it opens and gives it back when it closes. A wheel, a swipe or Escape closes it. Enter on the
// spiral opens the front cartridge (the keyboard path to the 3D click).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import { ITEMS, tagLabel } from "../../scene/items";
import { itemAtStep, spiral, subscribeSpiral } from "../../scene/spiral";
import { scramble } from "../../ui/scramble";
import { tOfStep } from "./camera";
import { useDetail } from "./detail";
import { stepGeometry } from "./stepper";

const selectedNow = () => spiral.selected;

export function Detail() {
  const { store, reduced } = useWorld();
  const detail = useDetail();
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const sel = useSyncExternalStore(subscribeSpiral, selectedNow);
  const box = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const item = sel >= 0 ? ITEMS[sel] : null;

  useEffect(() => {
    if (!item) return;
    back.current = document.activeElement as HTMLElement | null;
    if (title.current) scramble(title.current, item.title, { reduced });
    box.current?.focus({ preventScroll: true });
    const close = () => detailRef.current.close();
    // "Scroll to close": the page is held while the shot is, so a wheel or swipe means close.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) > 2) close();
    };
    let ty: number | null = null;
    const onTouchStart = (e: TouchEvent) => (ty = e.touches[0]?.clientY ?? null);
    const onTouchMove = (e: TouchEvent) => {
      if (ty !== null && Math.abs((e.touches[0]?.clientY ?? ty) - ty) > 24) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      back.current?.focus?.({ preventScroll: true });
    };
  }, [item, reduced]);

  // Enter on the spiral (not on a control) opens the front cartridge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Enter" || spiral.selected >= 0 || (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
      const f = store.frames.workshop;
      if (!f.current || f.t < tOfStep(0) - 0.01 || store.getCoarse().branch) return;
      // The step the scroll is on (the camera may still be gliding there).
      const g = stepGeometry(store);
      const d = g ? Math.min(g.last, Math.max(0, Math.round(g.stepAtY(store.targetY)))) : 0;
      const i = itemAtStep(d);
      if (i >= 0) {
        e.preventDefault();
        detailRef.current.open(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  return (
    <>
      <p className="world-detail-hint world-u" data-on={!!item} aria-hidden="true">
        Scroll to close
      </p>
      <div ref={box} className="world-detail" data-on={!!item} role="dialog" aria-label={item ? `${item.title}, cartridge` : "Cartridge"} aria-hidden={!item} tabIndex={-1}>
        {item ? (
          <>
            <div ref={title} className="world-detail__t world-u">
              {item.title}
            </div>
            <div className="world-detail__m world-u">
              2026 / {item.robot} / {tagLabel(item.tag)}
            </div>
            <p className="world-detail__p">{item.desc}</p>
            <div className="world-detail__row world-u">
              <button type="button" onClick={() => detail.plugIn(sel)}>
                Plug in →
              </button>
              <button type="button" className="world-detail__x" onClick={() => detail.close()}>
                ← Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
