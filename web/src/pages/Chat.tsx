import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/errors";
import { recordSpend } from "../api/usage";
import { ChatBar, EmptyState, GlassCard, StatusPill, Zones } from "../components";

type ChatResult = { action: string; result: string; est_cost_usd: number };
type Entry = { you: string; reply: string; action: string };

const examples = ["send the lamp to trash", "where are my keys?", "how many books do I have?"];

// What the backend actually did. "organize" only stores a proposal.
function actionPill(action: string) {
  if (action === "unknown") return null;
  if (action === "query") return <StatusPill>Answer</StatusPill>;
  if (action === "organize") return <StatusPill tone="warm">Proposal</StatusPill>;
  return <StatusPill tone="accent">Done · {action}</StatusPill>;
}

export default function Chat() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<Entry[]>([]);

  async function send() {
    if (!roomId || !text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.post<ChatResult>("/api/chat", { text, room_id: Number(roomId) });
      recordSpend(res.est_cost_usd);
      setLog((prev) => [...prev, { you: text, reply: res.result, action: res.action }]);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/" cta="Go to Home" />;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Chat</h1>
            <p className="muted">Tell SANT what to do in plain words. It checks every command against your inventory before anything changes.</p>
          </div>
          <div className="row wrap">
            {examples.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </>
      }
    >
      <ul className="stack chat-log">
        {log.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No messages yet. Try one of the examples.</p>
          </GlassCard>
        )}
        {log.map((entry, i) => (
          <li key={i} className="stack chat-entry">
            <GlassCard className="chat-you">
              <p>{entry.you}</p>
            </GlassCard>
            <GlassCard variant={entry.action === "unknown" || entry.action === "organize" ? "provisional" : "glass"} className="stack">
              <div className="row spread">
                <span className="muted small">SANT</span>
                {actionPill(entry.action)}
              </div>
              <p>{entry.reply}</p>
              {entry.action === "trash" && (
                <Link to={`/inventory?room_id=${roomId}&trash=1`} className="pill-link">
                  Undo in Inventory
                </Link>
              )}
            </GlassCard>
          </li>
        ))}
      </ul>
      <ChatBar value={text} onChange={setText} onSubmit={send} busy={busy} placeholder='e.g. "send the lamp to trash"' error={error} />
    </Zones>
  );
}
