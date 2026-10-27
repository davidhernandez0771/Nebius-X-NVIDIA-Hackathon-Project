// The first-visit guide (2026-10-27, "a tutorial to teach someone how to use the app"): four short cards in the
// workshop's room view, each pointing at the real thing there (guideSteps.ts): what SANT does, the shelf where you
// start a recording, the machine that checks and multiplies, the proof wall. It starts by itself the first time the
// visitor stands in the room view (after the story, or straight from a return), or at once from the hero's small
// offer, which skips the story to get there. Never over the story: the story is the scroll, and a card over it would
// sit on the words it is telling. Once per browser (guideState.ts); the "?" beside Contact replays it from anywhere.
// Skip on every card, Escape skips, the arrow keys step. Leaving the room view (opening a place, ↑ Story, the
// shelf) ends it. The layer lets clicks through (it sits over the 3D) except on its own controls, which opt back in
// (guideClicks.test.ts).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useWorld } from "../core/WorldContext";
import { GUIDE_STEPS, type GuideLink, type GuideTarget } from "./guideSteps";
import { placeCard, type Box } from "./guidePlace";
import {
  closeGuide,
  declineGuide,
  guideState,
  inRoomView,
  LAST,
  nextStep,
  openGuide,
  prevStep,
  requestGuide,
  seenGuide,
  showOffer,
  subscribeGuide,
} from "./guideState";
import "./guide.css";

/** After the room view comes up, the tags fade in (0.45 s): the first card waits for them. */
const SETTLE_MS = 600;

const onScreen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;

/**
 * What a step points at, on screen now: its tag in the room (HubTags, a card or the button over a hologram), else
 * the hub bar's button for it (a phone, the stills), else nothing.
 */
export function findTarget(id: GuideTarget | null): Box | null {
  if (!id) return null;
  const tag = document.querySelector<HTMLElement>(`.world-hubtag[data-hub="${id}"][data-on="true"]:not([data-drag="true"]) button`);
  const bar = document.querySelector<HTMLElement>(`.world-hubbar[data-on="true"] button[data-hub="${id}"]`);
  for (const el of [tag, bar]) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (onScreen(r)) return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return null;
}

function StepLink({ link, onPlace }: { link: GuideLink; onPlace: (p: "proof") => void }) {
  if ("to" in link) {
    return (
      <Link className="world-guide__link" to={link.to} onClick={() => closeGuide()}>
        {link.label} <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return (
    <button type="button" className="world-guide__link" onClick={() => onPlace(link.place)}>
      {link.label} <span aria-hidden="true">→</span>
    </button>
  );
}

/** The "?" that replays the guide from anywhere (beside Contact). */
export function GuideHelp() {
  return (
    <button type="button" className="world-guide-help" onClick={requestGuide} aria-label="Replay the tour" title="Replay the tour">
      <span className="world-guide-help__q" aria-hidden="true">
        ?
      </span>
      Tour
    </button>
  );
}

/** The hero's light offer, bottom left (a phone: under the top edge). It never covers the story's words. */
function Offer({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="world-guide-offer world-u" role="region" aria-label="Tour">
      <p className="world-guide-offer__line">
        <b>New here?</b> A 30-second tour shows you where to click.
      </p>
      <span className="world-guide-offer__row">
        <button type="button" className="world-guide__btn world-guide__btn--go" onClick={requestGuide}>
          Start the tour <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="world-guide__btn" onClick={declineGuide}>
          No thanks
        </button>
      </span>
    </div>
  );
}

export function GuideLayer({ toRoom }: { toRoom: () => void }) {
  const { store, goTo, reduced } = useWorld();
  const s = useSyncExternalStore(subscribeGuide, guideState);
  const open = s.step >= 0;
  const step = GUIDE_STEPS[Math.max(0, s.step)];
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const wire = useRef<SVGLineElement>(null);

  // Starting, and ending when the room view goes: from the store (a scroll, a place opening, the camera arriving).
  const toRoomRef = useRef(toRoom);
  toRoomRef.current = toRoom;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const room = () => store.getCoarse().ready && inRoomView(store.getCoarse(), store.frames.workshop.arrive);
    const tick = () => {
      const g = guideState();
      const here = room();
      if (g.step >= 0 && !here) closeGuide();
      const want = here && g.step < 0 && (g.pending || (!seenGuide() && !g.declined));
      if (!want) {
        if (timer && !here) {
          clearTimeout(timer);
          timer = undefined;
        }
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (room() && guideState().step < 0) openGuide(0);
      }, reduced ? 0 : SETTLE_MS);
    };
    tick();
    const offs = [store.subscribe(tick), store.onFrame(tick), subscribeGuide(tick)];
    return () => {
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
  }, [store, reduced]);

  // Asked for away from the room view (the hero's offer, the "?" in a place or the story): go there first.
  useEffect(() => {
    if (!s.pending) return;
    if (!inRoomView(store.getCoarse(), store.frames.workshop.arrive)) toRoomRef.current();
  }, [s.pending, store]);

  // The hero's offer: at the top of the story only.
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    const check = () =>
      setOffer(showOffer({ ready: store.getCoarse().ready, current: store.getCoarse().current, scrollY: window.scrollY, vh: window.innerHeight, seen: seenGuide(), s: guideState() }));
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const offs = [store.subscribe(check), subscribeGuide(check)];
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      offs.forEach((off) => off());
    };
  }, [store]);

  // Escape skips, the arrows step; first, so the room's own keys (the shelf, the filters) don't also take them.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const act = e.key === "Escape" ? closeGuide : e.key === "ArrowRight" ? nextStep : e.key === "ArrowLeft" ? prevStep : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // The card takes focus when the guide opens (a screen reader reads it; Tab reaches its buttons first).
  useEffect(() => {
    if (open) card.current?.focus({ preventScroll: true });
  }, [open]);

  // Follow the target every frame (the room's mouse look moves the tags), written straight to the DOM.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = "";
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = card.current;
      if (!el) return;
      const target = findTarget(step.target);
      const p = placeCard(target, { w: el.offsetWidth, h: el.offsetHeight }, window.innerWidth, window.innerHeight);
      const key = JSON.stringify([p, target && [Math.round(target.left), Math.round(target.top), Math.round(target.width), Math.round(target.height)]]);
      if (key === last) return;
      last = key;
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      el.style.width = p.width === null ? "" : `${p.width}px`;
      el.dataset.side = p.side;
      el.dataset.placed = "true";
      const r = ring.current;
      if (r) {
        r.dataset.on = String(!!target);
        if (target) {
          r.style.left = `${target.left - 6}px`;
          r.style.top = `${target.top - 6}px`;
          r.style.width = `${target.width + 12}px`;
          r.style.height = `${target.height + 12}px`;
        }
      }
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

  const toPlace = (p: "proof") => {
    closeGuide();
    goTo(p);
  };

  return (
    <>
      <Offer shown={offer && !open} />
      {open ? (
        <div className="world-guide" data-step={step.id}>
          <svg className="world-guide__wire" aria-hidden="true">
            <line ref={wire} />
          </svg>
          <div ref={ring} className="world-guide__ring" data-on="false" aria-hidden="true" />
          <div ref={card} className="world-guide__card" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} data-placed="false">
            <div className="world-guide__top world-u">
              <span className="world-guide__count">
                Step {s.step + 1} of {GUIDE_STEPS.length}
              </span>
              <button type="button" className="world-guide__skip" onClick={closeGuide}>
                Skip
              </button>
            </div>
            <h2 id={titleId} className="world-guide__title">
              {step.title}
            </h2>
            {step.lines.map((l) => (
              <p key={l} className="world-guide__line">
                {l}
              </p>
            ))}
            {step.links.length ? (
              <p className="world-guide__links">
                {step.links.map((l) => (
                  <StepLink key={l.label} link={l} onPlace={toPlace} />
                ))}
              </p>
            ) : null}
            <div className="world-guide__nav world-u">
              {s.step > 0 ? (
                <button type="button" className="world-guide__btn" onClick={prevStep}>
                  <span aria-hidden="true">← </span>Back
                </button>
              ) : null}
              <button type="button" className="world-guide__btn world-guide__btn--go" onClick={nextStep}>
                {s.step >= LAST ? "Done" : "Next"}
                {s.step >= LAST ? null : <span aria-hidden="true"> →</span>}
              </button>
              <span className="world-guide__keys" aria-hidden="true">
                <kbd>←</kbd> <kbd>→</kbd> step · <kbd>Esc</kbd> skips
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
