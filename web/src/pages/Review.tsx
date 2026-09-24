import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { DotMeter, EmptyState, GlassCard, ItemCard, StatusPill, ThreeWaySwitch, Zones } from "../components";
import type { Choice, ItemState } from "../components";

type Candidate = {
  id: number;
  label: string;
  category: string;
  count: number;
  uncertainty_note: string;
  status: string;
};

// "pending" is the AI's raw proposal. Only "organize" has become inventory.
function toState(status: string): ItemState {
  if (status === "organize") return "confirmed";
  if (status === "unknown") return "unknown";
  if (status === "trash") return "trash";
  return "proposed";
}

export default function Review() {
  const [params] = useSearchParams();
  const photoId = params.get("photo_id");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  // Passed via navigate() state right after analyze -- a one-time signal from
  // that specific call, not a persisted candidate property, so it's absent
  // (and correctly so) on a direct visit or a page refresh.
  const location = useLocation();
  const analyzeWarnings = (location.state as { warnings?: string[] } | null)?.warnings ?? [];

  useEffect(() => {
    if (!photoId) return;
    api.get<Candidate[]>(`/api/photos/${photoId}/candidates`).then(setCandidates).catch(console.error);
  }, [photoId]);

  async function sort(id: number, status: Choice) {
    setError("");
    try {
      await api.post(`/api/candidates/${id}/review`, { status });
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!photoId)
    return <EmptyState title="Nothing to review yet" hint="Upload a photo first." to="/add/photo" cta="Add a photo" />;

  const count = (s: ItemState) => candidates.filter((c) => toState(c.status) === s).length;
  const sorted = candidates.filter((c) => c.status !== "pending").length;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Review</h1>
            <p className="muted">
              SANT only proposes. Dashed cards are suggestions; a card turns solid once you organize it.
            </p>
          </div>
          <GlassCard as="section" className="stack">
            <div className="row spread">
              <h2>
                Sorted {sorted} of {candidates.length}
              </h2>
            </div>
            <DotMeter
              value={candidates.length ? sorted / candidates.length : 0}
              label="Candidates sorted"
              tone="accent"
              dots={20}
            />
            <div className="row wrap">
              <StatusPill tone="warm">{count("proposed")} proposed</StatusPill>
              <StatusPill tone="accent">{count("confirmed")} confirmed</StatusPill>
              <StatusPill tone="warm">{count("unknown")} unknown</StatusPill>
              <StatusPill tone="danger">{count("trash")} in trash</StatusPill>
            </div>
          </GlassCard>
        </>
      }
    >
      {error && <StatusPill tone="danger">{error}</StatusPill>}
      {analyzeWarnings.length > 0 && <StatusPill tone="warm">{analyzeWarnings.join(" ")}</StatusPill>}
      <ul className="stack">
        {candidates.map((c) => {
          const state = toState(c.status);
          const detail = [c.category || "uncategorized", `×${c.count}`].join(" · ");
          return (
            <ItemCard
              key={c.id}
              name={c.label}
              subline={c.uncertainty_note ? `${detail} · ${c.uncertainty_note}` : detail}
              state={state}
              // Trash is soft: Undo returns the item to "unknown" (the backend has no way back to "pending").
              onUndo={() => sort(c.id, "unknown")}
            >
              <ThreeWaySwitch
                label={`Sort ${c.label}`}
                value={c.status === "pending" ? null : (c.status as Choice)}
                onChange={(next) => sort(c.id, next)}
                // Once organized it's inventory; change it there, not by re-reviewing.
                disabled={c.status === "organize"}
              />
            </ItemCard>
          );
        })}
        {candidates.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No candidates for this photo.</p>
          </GlassCard>
        )}
      </ul>
    </Zones>
  );
}
