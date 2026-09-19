import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiUrl } from "../api/client";
import { errorMessage } from "../api/errors";
import { EmptyState, GlassCard, Icon, StatusPill, Zones } from "../components";

// three.js is heavy; only fetch it when a room actually has a scan to show.
const ScanViewer = lazy(() => import("../three/ScanViewer"));

type Location = { id: number; room_id: number; name: string };
type Room = { id: number; name: string };
type Scan = { id: number; room_id: number; uploaded_at: string };

export default function RoomView() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [locations, setLocations] = useState<Location[]>([]);
  const [roomName, setRoomName] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [scanId, setScanId] = useState<number | null>(null);

  useEffect(() => {
    if (!roomId) return;
    api.get<Location[]>(`/api/rooms/${roomId}/locations`).then(setLocations).catch(console.error);
    api.get<Room>(`/api/rooms/${roomId}`).then((r) => setRoomName(r.name)).catch(() => setRoomName(""));
    // Newest scan first; the viewer shows the latest one.
    api
      .get<Scan[]>(`/api/scans?room_id=${roomId}`)
      .then((scans) => setScanId(scans[0]?.id ?? null))
      .catch(() => setScanId(null));
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

          {scanId !== null ? (
            <>
              <div className="scan-viewer-frame" data-slot="scan-viewer">
                <Suspense fallback={<p className="muted scan-viewer-loading">Loading 3D viewer...</p>}>
                  <ScanViewer url={apiUrl(`/api/scans/${scanId}/file`)} />
                </Suspense>
              </div>
              <Link to={`/add/scan?room_id=${roomId}`} className="pill-link">
                Replace room scan
              </Link>
            </>
          ) : (
            <div className="scan-viewer-slot" data-slot="scan-viewer">
              <Icon name="scan" size={40} />
              <h2>No room scan yet</h2>
              <p className="muted">Upload a .glb scan and it will appear here as an orbit-able 3D room.</p>
              <Link to={`/add/scan?room_id=${roomId}`} className="pill-link">
                Upload a room scan
              </Link>
            </div>
          )}
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
