import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

type OrganizeResult = { proposal_id: number; suggestion: string; est_cost_usd: number };

export default function Organize() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!roomId) return;
    setLoading(true);
    try {
      const res = await api.post<OrganizeResult>("/api/organize", { room_id: Number(roomId) });
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  if (!roomId) return <p>Pick a room from Home first.</p>;

  return (
    <section>
      <h1>Organize</h1>
      <button onClick={ask} disabled={loading}>
        {loading ? "Asking Nemotron..." : "Suggest an arrangement"}
      </button>
      {result && (
        <div>
          <pre style={{ whiteSpace: "pre-wrap" }}>{result.suggestion}</pre>
          <p>Cost: ~${result.est_cost_usd.toFixed(5)}</p>
        </div>
      )}
    </section>
  );
}
