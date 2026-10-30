// The /record tour (2026-10-27): six short cards for a first-timer, each ringing the real thing on the page
// (tourSteps.ts): where you drive, the robot (an example replay until you start), the three aiming views, the live
// readouts, Record and the counter, and Run SANT. It opens by itself once per browser, a moment after the page draws
// in (tourState.ts); "? Tour" beside "? How to" replays it. Skip on every card, Escape skips, the arrows step.
// It is the workshop guide's look and logic (world/guide: Guide.tsx, guidePlace.ts, guide.css) in the hologram's
// tokens: the card's placement is guidePlace's placeCard itself; on a phone the card docks at the bottom and the page
// scrolls the ringed thing into view above it.
// Keys: while it is open, Escape and the arrows are the tour's (the arrows also drive the arm, so they are taken
// first, in the capture phase); Enter and Space on the card's own buttons press them and go no further (no grip, no
// recording). Once it closes its listener goes: W/A/S/D, Space, Enter all drive again.
// Clicks: the layer and its rings let every click through to the page; the card and its buttons take theirs back
// (tourClicks.test.ts, and the CDP run with real mouse events: web/scripts/record-tour-clicks.mjs).
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useMotion } from "../../../sant/motion/MotionProvider";
import { GAP, GUTTER, PHONE, placeCard, type Box } from "../../../world/guide/guidePlace";
import { TOUR_STEPS, type TourRing } from "./tourSteps";
import { TOUR_LAST, closeTour, nextTour, openTour, prevTour, seenTour, subscribeTour, tourState } from "./tourState";
import "./record-tour.css";

/** The page draws in (RecordConsole's BOOT_MS, 1.6 s) before the first card comes. */
export const AUTO_MS = 1900;
const AUTO_REDUCED_MS = 300;
/** Where a ringed thing stands after the tour scrolls it into view (a phone, where the page scrolls). */
const SCROLL_TO = 24;

const visible = (r: DOMRect) => r.width > 0 && r.height > 0;

/** The box round every visible element `sel` matches, or null. */
function boxOf(sel: string): Box | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!visible(rect)) return;
    l = Math.min(l, rect.left);
    t = Math.min(t, rect.top);
    r = Math.max(r, rect.right);
    b = Math.max(b, rect.bottom);
  });
  return l === Infinity ? null : { left: l, top: t, width: r - l, height: b - t };
}

/** A ring's box: its first selector that matches anything visible. */
export function findRing(ring: TourRing): Box | null {
  for (const sel of ring) {
    const box = boxOf(sel);
    if (box) return box;
  }
  return null;
}

/** "? Tour", beside "? How to" in the camera pane's header: replays the tour from the first card. */
export function TourButton() {
  return (
    <button type="button" className="rg-btn rg-btn--small rg-tour-btn" onClick={() => openTour(0, "button")} aria-label="Replay the tour" title="A one-minute tour of this page">
      <span aria-hidden="true">? </span>Tour
    </button>
  );
}

export function RecordTour({ streaming = false }: { streaming?: boolean }) {
  const { reduced } = useMotion();
  const s = useSyncExternalStore(subscribeTour, tourState);
  const open = s.step >= 0;
  const step = TOUR_STEPS[Math.max(0, s.step)];
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const rings = useRef<(HTMLDivElement | null)[]>([]);
  const wire = useRef<SVGLineElement>(null);
  const live = useRef({ streaming, reduced });
  live.current = { streaming, reduced };

  // A first visit: open by itself once the page has drawn in, unless the visitor is already driving.
  useEffect(() => {
    if (seenTour()) return;
    const id = window.setTimeout(() => {
      if (!seenTour() && tourState().step < 0 && !live.current.streaming) openTour(0, "auto");
    }, live.current.reduced ? AUTO_REDUCED_MS : AUTO_MS);
    return () => window.clearTimeout(id);
  }, []);

  // Leaving the page ends it (the state is the module's, so it would still be open on the way back).
  useEffect(() => () => closeTour(), []);

  // Escape skips and the arrows step, taken before the drive's own listeners see them (the arrows move the arm).
  // Enter and Space on the card's buttons press them and stop there. Nothing is held once it closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inCard = !!t && !!card.current?.contains(t);
      if (!inCard && t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return; // a field keeps its keys
      const act =
        e.key === "Escape" ? closeTour : e.key === "ArrowRight" ? nextTour : e.key === "ArrowLeft" ? prevTour : e.key === "ArrowUp" || e.key === "ArrowDown" ? () => {} : null;
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        act();
      } else if (inCard && (e.code === "Space" || e.code === "Enter" || e.key === "Enter" || e.key === " ")) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Focus: the card takes it when the tour opens (a screen reader reads it; Tab reaches its buttons first). On close
  // it goes back to "? Tour" if that opened it; else it is let go, so no button keeps it to catch a Space.
  const by = s.by;
  useEffect(() => {
    if (!open) return;
    card.current?.focus({ preventScroll: true });
    return () => {
      const a = document.activeElement as HTMLElement | null;
      if (by === "button") document.querySelector<HTMLElement>(".rg-tour-btn")?.focus({ preventScroll: true });
      else if (a && a !== document.body && a.closest(".rg-tour")) a.blur();
    };
  }, [open, by]);

  // Follow the rings every frame (the twin's views come in when the robot loads, a phone scrolls), written to the DOM.
  // Once per card, a ringed thing out of view is scrolled into it, above the docked card on a phone.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = "";
    let scrolled = false;
    const page = card.current?.closest<HTMLElement>(".rg") ?? null;
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = card.current;
      if (!el) return;
      const boxes = step.rings.map(findRing);
      const primary = boxes.find((b) => b) ?? null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const p = placeCard(primary, { w: el.offsetWidth, h: el.offsetHeight }, vw, vh);
      // A phone: room under the page's last things (the readouts, the counter) to scroll them up above the card.
      if (page) page.style.paddingBottom = vw < PHONE ? `${el.offsetHeight + GUTTER * 2}px` : "";
      if (!scrolled && primary) {
        scrolled = true;
        const room = (vw < PHONE ? vh - el.offsetHeight - GUTTER - GAP : vh - GUTTER) - SCROLL_TO;
        const out = primary.top < 0 || primary.top + Math.min(primary.height, room) > SCROLL_TO + room;
        if (out) window.scrollBy({ top: primary.top - SCROLL_TO, behavior: live.current.reduced ? "auto" : "smooth" });
      }
      const key = JSON.stringify([p, boxes.map((b) => b && [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)])]);
      if (key === last) return;
      last = key;
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      el.style.width = p.width === null ? "" : `${p.width}px`;
      el.dataset.side = p.side;
      el.dataset.placed = "true";
      rings.current.forEach((r, i) => {
        if (!r) return;
        const b = boxes[i];
        r.dataset.on = String(!!b);
        if (b) {
          r.style.left = `${b.left - 6}px`;
          r.style.top = `${b.top - 6}px`;
          r.style.width = `${b.width + 12}px`;
          r.style.height = `${b.height + 12}px`;
        }
      });
      const w = wire.current;
      if (w) {
        w.style.display = p.line ? "" : "none";
        if (p.line) {
          w.setAttribute("x1", String(p.line.x1));
          w.setAttribute("y1", String(p.line.y1));
          w.setAttribute("x2", String(p.line.x2));
          w.setAttribute("y2", String(p.line.y2));
        }
      }
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  // The phone's room under the page goes when the tour does (not between cards: the page would jump).
  useEffect(() => {
    if (!open) return;
    const page = card.current?.closest<HTMLElement>(".rg");
    return () => {
      if (page) page.style.paddingBottom = "";
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="rg-tour" data-step={step.id}>
      <svg className="rg-tour__wire" aria-hidden="true">
        <line ref={wire} />
      </svg>
      {step.rings.map((_, i) => (
        <div
          key={`${step.id}-${i}`}
          ref={(el) => {
            rings.current[i] = el;
          }}
          className="rg-tour__ring"
          data-on="false"
          aria-hidden="true"
        />
      ))}
      <div ref={card} className="rg-tour__card" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} data-placed="false">
        <div className="rg-tour__top">
          <span className="rg-tour__count">
            Step {s.step + 1} of {TOUR_STEPS.length}
          </span>
          <button type="button" className="rg-tour__skip" onClick={closeTour}>
            Skip
          </button>
        </div>
        <h2 id={titleId} className="rg-tour__title">
          {step.title}
        </h2>
        {step.lines.map((l) => (
          <p key={l} className="rg-tour__line">
            {l}
          </p>
        ))}
        <div className="rg-tour__nav">
          {s.step > 0 ? (
            <button type="button" className="rg-tour__btn" onClick={prevTour}>
              <span aria-hidden="true">← </span>Back
            </button>
          ) : null}
          <button type="button" className="rg-tour__btn rg-tour__btn--go" onClick={nextTour}>
            {s.step >= TOUR_LAST ? "Done" : "Next"}
            {s.step >= TOUR_LAST ? null : <span aria-hidden="true"> →</span>}
          </button>
          <span className="rg-tour__keys" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> step · <kbd>Esc</kbd> skips
          </span>
        </div>
      </div>
    </div>
  );
}
