import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { uploadFile } from "../api/client";
import { EmptyState, GlassCard, Icon, StatusPill, Zones } from "../components";
import { errorMessage } from "../api/errors";

export default function AddScan() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const roomId = params.get("room_id");
  const [status, setStatus] = useState<{ tone: "neutral" | "accent" | "danger"; text: string } | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    setStatus({ tone: "neutral", text: "Uploading..." });
    try {
      await uploadFile(`/api/scans?room_id=${roomId}`, file);
      // Take the user to the room, where the scan now renders.
      navigate(`/room?room_id=${roomId}`);
    } catch (err) {
      setStatus({ tone: "danger", text: `Failed: ${errorMessage(err)}` });
    }
  }

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/" cta="Go to Home" />;

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Upload a room scan</h1>
            <p className="muted">
              Scan your room with a third-party LiDAR app (Polycam, Scaniverse, "3D Scanner App") and export as .glb, then upload it here.
            </p>
          </div>
          <label className="upload-drop">
            <Icon name="scan" size={36} />
            <span>Choose a .glb file</span>
            <input type="file" accept=".glb" onChange={handleUpload} className="sr-only" />
          </label>
          {status && <StatusPill tone={status.tone}>{status.text}</StatusPill>}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <h2>How to scan</h2>
        <ol className="steps">
          <li>Open a LiDAR scanning app and walk the room slowly.</li>
          <li>Export the result as a .glb file.</li>
          <li>Upload it here. It becomes the 3D view of your room.</li>
        </ol>
      </GlassCard>
    </Zones>
  );
}
