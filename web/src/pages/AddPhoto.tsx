import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, uploadFile } from "../api/client";

type Photo = { id: number; location_id: number };
type Candidate = {
  id: number;
  label: string;
  category: string;
  count: number;
  uncertainty_note: string;
  status: string;
};
type AnalyzeResult = { photo_id: number; candidates: Candidate[]; est_cost_usd: number };

export default function AddPhoto() {
  const [params] = useSearchParams();
  const locationId = params.get("location_id");
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("");

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !locationId) return;
    setStatus("Uploading photo...");
    try {
      const photo = await uploadFile<Photo>(`/api/photos?location_id=${locationId}`, file);
      setStatus("Analyzing -- this calls a vision model and costs a small amount...");
      const result = await api.post<AnalyzeResult>(`/api/photos/${photo.id}/analyze`);
      setStatus(`Found ${result.candidates.length} candidate item(s), ~$${result.est_cost_usd.toFixed(5)}.`);
      navigate(`/review?photo_id=${photo.id}`);
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  }

  if (!locationId) return <p>Pick a location from Room view first.</p>;

  return (
    <section>
      <h1>Photograph an area</h1>
      <input type="file" accept="image/*" onChange={handleUpload} />
      <p>{status}</p>
    </section>
  );
}
