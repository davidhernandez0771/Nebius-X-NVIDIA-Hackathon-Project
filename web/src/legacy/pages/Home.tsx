import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { GlassCard, Icon, StatusPill, Zones } from "../components";

type Room = { id: number; name: string };

export default function Home() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Room[]>("/api/rooms").then(setRooms).catch(console.error);
  }, []);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      const room = await api.post<Room>("/api/rooms", { name });
      setRooms((prev) => [...prev, room]);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Your rooms</h1>
            <p className="muted">
              Scan a room, photograph what's in it, and SANT proposes a tidier layout. Nothing changes until you decide.
            </p>
          </div>
          <GlassCard as="section">
            <form className="stack" onSubmit={createRoom}>
              <h2>Add a room</h2>
              <div className="row form-row">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New room name" aria-label="New room name" />
                <button type="submit" className="primary-button">
                  Add room
                </button>
              </div>
              {error && <StatusPill tone="danger">{error}</StatusPill>}
            </form>
          </GlassCard>
        </>
      }
    >
      <ul className="stack">
        {rooms.map((r) => (
          <GlassCard as="li" key={r.id} className="list-card">
            <Link to={`/room?room_id=${r.id}`} className="list-link">
              <span className="item-card-thumb">
                <Icon name="room" size={24} />
              </span>
              <span className="list-link-text">
                <h3>{r.name}</h3>
                <span className="muted small">Open room</span>
              </span>
              <Icon name="chevron" size={18} />
            </Link>
          </GlassCard>
        ))}
        {rooms.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No rooms yet. Add your first one.</p>
          </GlassCard>
        )}
      </ul>
    </Zones>
  );
}
