import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

type ChatResult = { action: string; result: string; est_cost_usd: number };

export default function Chat() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ you: string; reply: string }[]>([]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId || !text.trim()) return;
    const res = await api.post<ChatResult>("/api/chat", { text, room_id: Number(roomId) });
    setLog((prev) => [...prev, { you: text, reply: res.result }]);
    setText("");
  }

  if (!roomId) return <p>Pick a room from Home first.</p>;

  return (
    <section>
      <h1>Chat</h1>
      <ul>
        {log.map((entry, i) => (
          <li key={i} style={{ marginBottom: "0.5rem" }}>
            <div>you: {entry.you}</div>
            <div>assistant: {entry.reply}</div>
          </li>
        ))}
      </ul>
      <form onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "send the lamp to trash"'
          style={{ width: "70%" }}
        />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
