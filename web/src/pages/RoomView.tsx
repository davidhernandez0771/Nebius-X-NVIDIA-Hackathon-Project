import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { EmptyState, GlassCard, Icon, StatusPill, Zones } from "../components";

type Location = { id: number; room_id: number; name: string };
type Room = { id: number; name: string };

export default function RoomView() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [locations, setLocations] = useState<Location[]>([]);
  const [roomName, setRoomName] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!roomId) return;
    api.get<Location[]>(`/api/rooms/${roomId}/locations`).then(setLocations).catch(console.error);
    api.get<Room>(`/api/rooms/${roomId}`).then((r) => setRoomName(r.name)).catch(() => setRoomName(""));
  }, [roomId]);

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId || !name.trim()) return;
    setError("");
    try {
      const loc = await api.post<Location>(`/api/rooms/${roomId}/locations`, { name });
      setLocations((prev) => [...prev, loc]);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/" cta="Go to Home" />;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>{roomName || `Room ${roomId}`}</h1>
            <p className="muted">Locations you add here are where photographed items get filed.</p>
          </div>

          {/* ================================================================
              PLACEHOLDER: 3D SCAN VIEWER
              The 3D terminal mounts the orbit-able GLB room viewer in this
              slot (data-slot="scan-viewer"), with candidate cards pinned to
              where items were seen. Intentionally empty: no three.js in the
              UI pass. Replace the contents of this div, keep the wrapper.
              ================================================================ */}
          <div className="scan-viewer-slot" data-slot="scan-viewer" role="img" aria-label="Placeholder for the 3D room scan">
            <Icon name="scan" size={40} />
            <h2>3D scan viewer</h2>
            <p className="muted">Your room scan will appear here.</p>
            <StatusPill>Placeholder</StatusPill>
            <Link to={`/add/scan?room_id=${roomId}`} className="pill-link">
              Upload a room scan
            </Link>
          </div>
        </>
      }
    >
      <ul className="stack">
        {locations.map((l) => (
          <GlassCard as="li" key={l.id} className="location-card">
            <span className="item-card-thumb">
              <Icon name="shelf" size={24} />
            </span>
            <div className="item-card-text">
              <h3>{l.name}</h3>
              <p className="muted small">Storage location</p>
            </div>
            <Link to={`/add/photo?location_id=${l.id}`} className="pill-link">
              Add photo
            </Link>
          </GlassCard>
        ))}
        {locations.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No locations yet. Add a shelf, drawer or desk below.</p>
          </GlassCard>
        )}
      </ul>
      <GlassCard as="section">
        <form className="stack" onSubmit={addLocation}>
          <h3>Add a location</h3>
          <div className="row form-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Top shelf" aria-label="Location name" />
            <button type="submit" className="primary-button">
              Add
            </button>
          </div>
          {error && <StatusPill tone="danger">{error}</StatusPill>}
        </form>
      </GlassCard>
    </Zones>
  );
}
