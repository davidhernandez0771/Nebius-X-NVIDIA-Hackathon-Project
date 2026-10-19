// The tour's caption over each stop (tour.ts).
import { TOUR, useTour } from "./tour";

export function TourCaption() {
  const step = useTour();
  if (step < 0) return null;
  const s = TOUR[step];
  return (
    <div className="world-tour" aria-live="polite">
      <h3>{s.title}</h3>
      <p>{s.line}</p>
      <p className="world-u" style={{ marginTop: 14, color: "var(--w-dim)" }}>
        Scroll or Esc to end the tour
      </p>
    </div>
  );
}
