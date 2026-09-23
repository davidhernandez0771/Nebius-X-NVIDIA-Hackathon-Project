import { useEffect, useRef } from "react";
import { animate } from "animejs";
import type { HandPointerApi } from "../contracts";
import { prefersReducedMotion } from "../../three/capability";
import "./handCursorOverlay.css";

type Props = { api: HandPointerApi };

/**
 * App-wide visual layer for the hand-controlled cursor: a dot that tracks the
 * fingertip, a highlight ring drawn around whatever `hoverTarget` resolves to
 * (never the target's own `:hover`), a perimeter-tracing dwell border, and
 * short pulses on select/dwell activation.
 *
 * Purely presentational against `HandPointerApi` -- owns no tracking,
 * gesture, or hit-testing logic. `pointer-events: none` end to end so it can
 * never steal a real click; mount it once, app-wide, outside <Routes>.
 */
export function HandCursorOverlay({ api }: Props) {
  const {
    cursor,
    hoverTarget,
    phase,
    status,
    enabled,
    twoHandZoom,
    dwellTarget,
    dwellProgress,
    onDwellEvent,
    isSelecting,
    cursorShape,
  } = api;

  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const zoomPrimaryRef = useRef<HTMLDivElement>(null);
  const zoomSecondaryRef = useRef<HTMLDivElement>(null);
  const zoomLineRef = useRef<SVGLineElement>(null);
  const zoomBadgeRef = useRef<HTMLDivElement>(null);
  const dwellRectRef = useRef<SVGRectElement>(null);
  const dwellRadiusRef = useRef(20); // px, refreshed from the target's own computed style on change

  const zooming = phase === "zooming" && twoHandZoom !== null;
  // The standalone dot/ring double up on the primary hand's own zoom marker
  // during a two-hand gesture, and one-hand hover/click is suppressed while
  // zooming anyway (see contracts.ts) -- hide them so zoom reads cleanly.
  const showCursor = enabled && cursor !== null && !zooming;
  const showRing = enabled && hoverTarget !== null && !zooming;
  const showZoom = enabled && zooming;
  const showDwell = enabled && dwellTarget !== null;
  const prevHoverTargetRef = useRef<HTMLElement | null>(null);

  // Shared by the select-activation pulse below and the dwellactivate
  // handler further down -- one "confirmation" visual for both activation
  // paths, per the plan's "reuse/adapt your existing activation-pulse".
  function firePulse(point: { x: number; y: number }) {
    const pulse = pulseRef.current;
    if (!pulse) return;
    pulse.style.left = `${point.x}px`;
    pulse.style.top = `${point.y}px`;
    animate(pulse, {
      opacity: [0.6, 0],
      scale: [0.4, prefersReducedMotion() ? 1 : 1.8],
      duration: prefersReducedMotion() ? 0 : 320,
      ease: "outExpo",
    });
  }

  // Raw position: a direct style write on every update, not a per-frame
  // Anime.js tween (that would stack/leak). This is the one thing that must
  // never lag, so it bypasses CSS transitions too. Written via left/top (not
  // transform) so Anime.js is free to drive this same element's `scale` via
  // `transform` elsewhere without the two writes clobbering each other.
  useEffect(() => {
    const dot = dotRef.current;
    if (dot && cursor) {
      dot.style.left = `${cursor.x}px`;
      dot.style.top = `${cursor.y}px`;
    }
    const ring = ringRef.current;
    if (ring && hoverTarget && hoverTarget.isConnected) {
      const rect = hoverTarget.getBoundingClientRect();
      // The ring's left/top/width/height glide via a CSS transition (see
      // handCursorOverlay.css) so it can slide smoothly between two
      // adjacent hover targets. On first appearance (no previous target)
      // that same transition would make it visibly slide in from wherever
      // it was last parked -- suppress it for exactly this one write so it
      // snaps straight to place instead, then restore it for subsequent moves.
      const justAppeared = prevHoverTargetRef.current === null;
      if (justAppeared) ring.style.transitionProperty = "none";
      ring.style.left = `${rect.left}px`;
      ring.style.top = `${rect.top}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;
      if (justAppeared) {
        void ring.offsetHeight; // flush the "none" before re-enabling
        ring.style.transitionProperty = "";
      }
    }
    prevHoverTargetRef.current = hoverTarget;

    // Dwell perimeter border: geometry + progress, written every tracked
    // frame like the ring above (dwellProgress ticks at the same cadence).
    const dwellRect = dwellRectRef.current;
    if (dwellRect && dwellTarget && dwellTarget.isConnected) {
      const rect = dwellTarget.getBoundingClientRect();
      dwellRect.setAttribute("x", String(rect.left));
      dwellRect.setAttribute("y", String(rect.top));
      dwellRect.setAttribute("width", String(rect.width));
      dwellRect.setAttribute("height", String(rect.height));
      // Corner radius is read from the real target so this traces its
      // actual shape (IconTile: --radius-tile, 20px today) rather than
      // assuming a fixed value that could drift out of sync with tokens.css.
      const radius = parseFloat(getComputedStyle(dwellTarget).borderTopLeftRadius) || dwellRadiusRef.current;
      dwellRadiusRef.current = radius;
      dwellRect.setAttribute("rx", String(radius));
      dwellRect.setAttribute("ry", String(radius));
      // pathLength="1" (set once in JSX) redefines the rect's total stroke
      // length as exactly 1 unit regardless of actual perimeter, so progress
      // is just (1 - dwellProgress) -- no rounded-rect perimeter math needed.
      dwellRect.style.strokeDashoffset = String(1 - dwellProgress);
    }
  }, [cursor, hoverTarget, dwellTarget, dwellProgress]);

  // Two-hand zoom markers/line/badge: same rule as the dot above -- direct
  // writes every tracked frame, transform left free for Anime.js.
  useEffect(() => {
    if (!twoHandZoom) return;
    const { primaryPoint, secondaryPoint, ratio } = twoHandZoom;

    const primary = zoomPrimaryRef.current;
    if (primary) {
      primary.style.left = `${primaryPoint.x}px`;
      primary.style.top = `${primaryPoint.y}px`;
    }
    const secondary = zoomSecondaryRef.current;
    if (secondary) {
      secondary.style.left = `${secondaryPoint.x}px`;
      secondary.style.top = `${secondaryPoint.y}px`;
    }
    const line = zoomLineRef.current;
    if (line) {
      line.setAttribute("x1", String(primaryPoint.x));
      line.setAttribute("y1", String(primaryPoint.y));
      line.setAttribute("x2", String(secondaryPoint.x));
      line.setAttribute("y2", String(secondaryPoint.y));
    }
    const badge = zoomBadgeRef.current;
    if (badge) {
      const midX = (primaryPoint.x + secondaryPoint.x) / 2;
      const midY = (primaryPoint.y + secondaryPoint.y) / 2;
      badge.style.left = `${midX}px`;
      badge.style.top = `${midY}px`;
      const pct = Math.round((ratio - 1) * 100);
      badge.textContent = `${pct >= 0 ? "+" : ""}${pct}%`;
      badge.dataset.direction = ratio >= 1 ? "in" : "out";
    }
  }, [twoHandZoom]);

  // Cursor show/hide -- discrete state change, so Anime.js.
  useEffect(() => {
    const dot = dotRef.current;
    if (!dot) return;
    const anim = animate(dot, {
      opacity: showCursor ? [0, 1] : [1, 0],
      scale: showCursor ? [0.5, 1] : [1, 0.5],
      duration: prefersReducedMotion() ? 0 : 180,
      ease: "outExpo",
    });
    return () => {
      anim.revert();
    };
  }, [showCursor]);

  // Hover ring enter/exit -- discrete state change, so Anime.js. Switching
  // directly between two non-null targets is handled by the CSS position
  // transition on the ring (see .hand-cursor-ring); this only fires the
  // pulse on the null<->non-null edges.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const anim = animate(ring, {
      opacity: showRing ? [0, 1] : [1, 0],
      scale: showRing ? [0.75, 1] : [1, 0.9],
      duration: prefersReducedMotion() ? 0 : 200,
      ease: "outQuad",
    });
    return () => {
      anim.revert();
    };
  }, [showRing]);

  // Activation pulse -- fires exactly on a completed click: phase was
  // "armed" (select-down over an eligible target) and is now neither "armed"
  // nor "dragging", i.e. released before crossing the drag threshold. A
  // drag-end ("dragging" -> "pointing") is not a click and gets no pulse.
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    const activated = prevPhase === "armed" && phase !== "armed" && phase !== "dragging";
    if (!activated || !cursor) return;
    firePulse(cursor);
  }, [phase, cursor]);

  // Dwell perimeter border enter/exit -- discrete state change, so Anime.js.
  useEffect(() => {
    const rect = dwellRectRef.current;
    if (!rect) return;
    const anim = animate(rect, {
      opacity: showDwell ? [0, 1] : [1, 0],
      duration: prefersReducedMotion() ? 0 : 180,
      ease: "outQuad",
    });
    return () => {
      anim.revert();
    };
  }, [showDwell]);

  // Dwell activation confirmation -- one-shot, keyed off the discrete
  // dwellactivate event (not inferred from dwellProgress reaching 1, since
  // the animation completing on screen must never itself be what fires the
  // action -- see contracts.ts). Reuses the same pulse as select-activation,
  // positioned at the dwelled target's own center rather than the cursor.
  useEffect(() => {
    return onDwellEvent((event) => {
      if (event.type !== "dwellactivate") return;
      const rect = event.target.getBoundingClientRect();
      firePulse({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    });
  }, [onDwellEvent]);

  // Entering/leaving two-hand zoom -- discrete state change, so Anime.js.
  // Only opacity is animated here (never transform): the markers/line/badge
  // above are positioned via left/top writes every frame, so leaving
  // `transform` untouched means this animation can never clobber that.
  useEffect(() => {
    const targets = [zoomPrimaryRef.current, zoomSecondaryRef.current, zoomLineRef.current, zoomBadgeRef.current].filter(
      (el): el is HTMLDivElement | SVGLineElement => el !== null,
    );
    if (targets.length === 0) return;
    const anim = animate(targets, {
      opacity: showZoom ? [0, 1] : [1, 0],
      duration: prefersReducedMotion() ? 0 : 220,
      ease: "outQuad",
    });
    return () => {
      anim.revert();
    };
  }, [showZoom]);

  return (
    <div className="hand-cursor-overlay" aria-hidden="true">
      {enabled && (status === "loading" || status === "error") && (
        <div className="hand-cursor-status" data-status={status}>
          {status === "loading" ? "Starting hand tracking…" : "Hand tracking lost the camera"}
        </div>
      )}
      <div ref={ringRef} className="hand-cursor-ring" data-selecting={isSelecting} />
      <div ref={pulseRef} className="hand-cursor-pulse" />
      <div ref={dotRef} className="hand-cursor-dot" data-selecting={isSelecting} data-shape={cursorShape}>
        <span className="hand-cursor-dot-fill" />
      </div>

      <svg className="hand-dwell-svg">
        <rect ref={dwellRectRef} className="hand-dwell-ring" pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
      </svg>

      <svg className="hand-zoom-line-svg">
        <line ref={zoomLineRef} className="hand-zoom-line" x1={0} y1={0} x2={0} y2={0} />
      </svg>
      <div ref={zoomPrimaryRef} className="hand-zoom-marker" />
      <div ref={zoomSecondaryRef} className="hand-zoom-marker" />
      <div ref={zoomBadgeRef} className="hand-zoom-badge" data-direction="in" />
    </div>
  );
}
