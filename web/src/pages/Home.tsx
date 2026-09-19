import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type Room = { id: number; name: string };

export default function Home() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    api.get<Room[]>("/api/rooms").then(setRooms).catch(console.error);
  }, []);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const room = await api.post<Room>("/api/rooms", { name });
    setRooms((prev) => [...prev, room]);
    setName("");
  }

  return (
    <section>
      <h1>Rooms</h1>
      <ul>
        {rooms.map((r) => (
          <li key={r.id}>
            <Link to={`/room?room_id=${r.id}`}>{r.name}</Link>
          </li>
        ))}
      </ul>
      <form onSubmit={createRoom}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New room name" />
        <button type="submit">Add room</button>
      </form>
    </section>
  );
}
