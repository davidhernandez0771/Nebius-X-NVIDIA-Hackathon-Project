import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

type Candidate = {
  id: number;
  label: string;
  category: string;
  count: number;
  uncertainty_note: string;
  status: string;
};

export default function Review() {
  const [params] = useSearchParams();
  const photoId = params.get("photo_id");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    if (!photoId) return;
    api.get<Candidate[]>(`/api/photos/${photoId}/candidates`).then(setCandidates).catch(console.error);
  }, [photoId]);

  async function sort(id: number, status: "organize" | "unknown" | "trash") {
    await api.post(`/api/candidates/${id}/review`, { status });
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  }

  if (!photoId) return <p>Upload a photo from Add photo first.</p>;

  return (
    <section>
      <h1>Review</h1>
      <ul>
        {candidates.map((c) => (
          <li key={c.id} style={{ marginBottom: "0.5rem" }}>
            <strong>{c.label}</strong> ({c.category || "uncategorized"}, x{c.count})
            {c.uncertainty_note && <> -- {c.uncertainty_note}</>} <em>[{c.status}]</em>
            <div>
              <button onClick={() => sort(c.id, "organize")}>Organize</button>{" "}
              <button onClick={() => sort(c.id, "unknown")}>Unknown</button>{" "}
              <button onClick={() => sort(c.id, "trash")}>Trash</button>
            </div>
          </li>
        ))}
        {candidates.length === 0 && <p>No candidates for this photo.</p>}
      </ul>
    </section>
  );
}
