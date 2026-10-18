import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { recordSpend } from "../api/usage";
import { EmptyState, GlassCard, ItemCard, StatusPill, Zones } from "../components";

type OrganizeResult = { proposal_id: number; suggestion: string; est_cost_usd: number };

// The backend returns one canonical line per move: "- <item> -> <location>: <reason>".
function parseMoves(text: string) {
  const moves: { item: string; location: string; reason: string }[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-\s*(.+?)\s*->\s*(.+?)\s*:\s*(.*)$/);
    if (m) moves.push({ item: m[1], location: m[2], reason: m[3] });
  }
  return moves;
}

export default function Organize() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    if (!roomId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post<OrganizeResult>("/api/organize", { room_id: Number(roomId) });
      recordSpend(res.est_cost_usd);
      setResult(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/home" cta="Go to Home" />;

  const moves = result ? parseMoves(result.suggestion) : [];

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Organize</h1>
            <p className="muted">
              Ask for a tidier arrangement using only what you already own. It is a suggestion; nothing moves on its own.
            </p>
          </div>
          <div className="row wrap">
            <button className="primary-button" onClick={ask} disabled={loading}>
              {loading ? "Asking Nemotron..." : "Suggest an arrangement"}
            </button>
            {result && <StatusPill title="Estimated cost of this suggestion">~${result.est_cost_usd.toFixed(5)}</StatusPill>}
          </div>
          {error && <StatusPill tone="danger">{error}</StatusPill>}
        </>
      }
    >
      {!result && (
        <GlassCard variant="provisional">
          <p className="muted">No suggestion yet. Ask for one and it will show up here as a proposal.</p>
        </GlassCard>
      )}
      {result && (
        <ul className="stack">
          {moves.map((m, i) => (
            <ItemCard key={i} name={m.item} subline={`Move to ${m.location}${m.reason ? ` · ${m.reason}` : ""}`} state="proposed" icon="organize" />
          ))}
          {moves.length === 0 && (
            <GlassCard as="li" variant="provisional">
              <p className="muted">{result.suggestion}</p>
            </GlassCard>
          )}
        </ul>
      )}
      {result && moves.length > 0 && <p className="muted small panel-note">Proposal only: nothing has moved.</p>}
    </Zones>
  );
}
