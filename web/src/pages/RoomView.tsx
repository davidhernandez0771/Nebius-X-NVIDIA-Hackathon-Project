import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

type Location = { id: number; room_id: number; name: string };

export default function RoomView() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [locations, setLocations] = useState<Location[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!roomId) return;
    api.get<Location[]>(`/api/rooms/${roomId}/locations`).then(setLocations).catch(console.error);
  }, [roomId]);

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId || !name.trim()) return;
    const loc = await api.post<Location>(`/api/rooms/${roomId}/locations`, { name });
    setLocations((prev) => [...prev, loc]);
    setName("");
  }

  if (!roomId) return <p>Pick a room from Home first.</p>;

  return (
    <section>
      <h1>Room {roomId}</h1>
      <p>
        Scan rendering isn't built yet (see docs/ARCHITECTURE.md §10, step 3) --
        this screen just manages storage locations for now.
      </p>
      <ul>
        {locations.map((l) => (
          <li key={l.id}>
            {l.name} -- <Link to={`/add/photo?location_id=${l.id}`}>add photo</Link>
          </li>
        ))}
      </ul>
      <form onSubmit={addLocation}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Top shelf" />
        <button type="submit">Add location</button>
      </form>
      <p>
        <Link to={`/add/scan?room_id=${roomId}`}>Upload a room scan</Link>
      </p>
    </section>
  );
}
