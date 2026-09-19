import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, uploadFile } from "../api/client";
import { errorMessage } from "../api/errors";
import { recordSpend } from "../api/usage";
import { EmptyState, GlassCard, Icon, StatusPill, Zones } from "../components";

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
  const [status, setStatus] = useState<{ tone: "neutral" | "accent" | "danger"; text: string } | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !locationId) return;
    setStatus({ tone: "neutral", text: "Uploading photo..." });
    try {
      const photo = await uploadFile<Photo>(`/api/photos?location_id=${locationId}`, file);
      setStatus({ tone: "neutral", text: "Analyzing -- this calls a vision model and costs a small amount..." });
      const result = await api.post<AnalyzeResult>(`/api/photos/${photo.id}/analyze`);
      recordSpend(result.est_cost_usd);
      setStatus({
        tone: "accent",
        text: `Found ${result.candidates.length} candidate item(s), ~$${result.est_cost_usd.toFixed(5)}.`,
      });
      navigate(`/review?photo_id=${photo.id}`);
    } catch (err) {
      setStatus({ tone: "danger", text: `Failed: ${errorMessage(err)}` });
    }
  }

  if (!locationId)
    return <EmptyState title="Pick a location first" hint="Choose a location from Room view." to="/room" cta="Go to Room view" />;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Photograph an area</h1>
            <p className="muted">Take a clear photo of one shelf, drawer or desk. SANT proposes what it sees; you confirm.</p>
          </div>
          <label className="upload-drop">
            <Icon name="camera" size={36} />
            <span>Choose a photo</span>
            <input type="file" accept="image/*" onChange={handleUpload} className="sr-only" />
          </label>
          {status && <StatusPill tone={status.tone}>{status.text}</StatusPill>}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <h2>What happens next</h2>
        <ol className="steps">
          <li>The photo is uploaded and analyzed by a vision model.</li>
          <li>Each item it spots becomes a proposal, not an inventory entry.</li>
          <li>You sort each one in Review: organize, unknown or trash.</li>
        </ol>
      </GlassCard>
    </Zones>
  );
}
