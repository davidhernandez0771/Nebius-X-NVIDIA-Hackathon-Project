import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { EmptyState, GlassCard, Icon, ItemCard, StatusPill, Toggle, Zones } from "../components";

type Item = { id: number; name: string; category: string; quantity: number; status: string };

export default function Inventory() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [items, setItems] = useState<Item[]>([]);
  const [showTrash, setShowTrash] = useState(params.get("trash") === "1");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!roomId) return;
    api
      .get<Item[]>(`/api/items?room_id=${roomId}${showTrash ? "&include_trash=true" : ""}`)
      .then(setItems)
      .catch(console.error);
  }, [roomId, showTrash]);

  // Trash is soft: the card stays (muted) with an Undo until the list reloads.
  async function setStatus(id: number, status: "active" | "trash") {
    setError("");
    try {
      const updated = await api.patch<Item>(`/api/items/${id}`, { status });
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: updated.status } : i)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/" cta="Go to Home" />;

  const active = items.filter((i) => i.status !== "trash").length;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Inventory</h1>
            <p className="muted">Everything you've confirmed in this room.</p>
          </div>
          <GlassCard as="section" className="stack">
            <div className="row spread">
              <div>
                <h2>
                  {active} {active === 1 ? "item" : "items"}
                </h2>
                <p className="muted small">Confirmed and in the room</p>
              </div>
              <label className="row toggle-label">
                <span className="muted small">Show trash</span>
                <Toggle checked={showTrash} onChange={setShowTrash} label="Show trash" />
              </label>
            </div>
          </GlassCard>
        </>
      }
    >
      {error && <StatusPill tone="danger">{error}</StatusPill>}
      <ul className="stack">
        {items.map((i) => {
          const inTrash = i.status === "trash";
          return (
            <ItemCard
              key={i.id}
              name={i.name}
              subline={`${i.category || "uncategorized"} · ×${i.quantity}`}
              state={inTrash ? "trash" : "confirmed"}
              onUndo={() => setStatus(i.id, "active")}
            >
              {!inTrash && (
                <button type="button" className="ghost-button" onClick={() => setStatus(i.id, "trash")}>
                  <Icon name="trash" size={16} /> Move to trash
                </button>
              )}
            </ItemCard>
          );
        })}
        {items.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No items yet.</p>
          </GlassCard>
        )}
      </ul>
    </Zones>
  );
}
