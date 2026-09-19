import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

type Item = { id: number; name: string; category: string; quantity: number; status: string };

export default function Inventory() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [items, setItems] = useState<Item[]>([]);
  const [showTrash, setShowTrash] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    api
      .get<Item[]>(`/api/items?room_id=${roomId}${showTrash ? "&include_trash=true" : ""}`)
      .then(setItems)
      .catch(console.error);
  }, [roomId, showTrash]);

  if (!roomId) return <p>Pick a room from Home first.</p>;

  return (
    <section>
      <h1>Inventory</h1>
      <label>
        <input type="checkbox" checked={showTrash} onChange={(e) => setShowTrash(e.target.checked)} />
        Show trash
      </label>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            {i.name} ({i.category || "uncategorized"}, x{i.quantity}) [{i.status}]
          </li>
        ))}
        {items.length === 0 && <p>No items yet.</p>}
      </ul>
    </section>
  );
}
