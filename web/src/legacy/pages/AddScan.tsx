import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, uploadFile, uploadFiles } from "../api/client";
import { EmptyState, GlassCard, Icon, StatusPill, Zones } from "../components";
import { errorMessage } from "../api/errors";

const MIN_PHOTOS = 8; // matches the backend's own minimum (routers/phone_scans.py)
const POLL_INTERVAL_MS = 3000;

type PhoneScanStatus = {
  id: number;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  scan_id: number | null;
};

export default function AddScan() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const roomId = params.get("room_id");
  const [mode, setMode] = useState<"upload" | "capture">("upload");

  // --- Existing flow: upload a .glb exported from a third-party scanning app ---
  const [status, setStatus] = useState<{ tone: "neutral" | "accent" | "danger"; text: string } | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    setStatus({ tone: "neutral", text: "Uploading..." });
    try {
      await uploadFile(`/api/scans?room_id=${roomId}`, file);
      navigate(`/room?room_id=${roomId}`);
    } catch (err) {
      setStatus({ tone: "danger", text: `Failed: ${errorMessage(err)}` });
    }
  }

  // --- New flow: reconstruct a scan from photos taken in the app ---
  const [photos, setPhotos] = useState<File[]>([]);
  const [job, setJob] = useState<PhoneScanStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captureError, setCaptureError] = useState("");

  const photoUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => {
    return () => {
      for (const url of photoUrls) URL.revokeObjectURL(url);
    };
  }, [photoUrls]);

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so capturing again fires onChange even for a similarly-named file
    if (!file) return;
    setPhotos((prev) => [...prev, file]);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitCapture() {
    if (!roomId || photos.length < MIN_PHOTOS) return;
    setSubmitting(true);
    setCaptureError("");
    try {
      const created = await uploadFiles<PhoneScanStatus>(`/api/rooms/${roomId}/phone-scans`, photos);
      setJob(created);
    } catch (err) {
      setCaptureError(errorMessage(err));
      setSubmitting(false);
    }
  }

  // Poll while a job is in flight; stop on a terminal status.
  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const id = setInterval(async () => {
      try {
        const next = await api.get<PhoneScanStatus>(`/api/phone-scans/${job.id}/status`);
        setJob(next);
      } catch (err) {
        setCaptureError(errorMessage(err));
        setSubmitting(false);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [job]);

  useEffect(() => {
    if (job?.status === "completed" && roomId) navigate(`/room?room_id=${roomId}`);
  }, [job, roomId, navigate]);

  if (!roomId) return <EmptyState title="Pick a room first" hint="Choose a room from Home." to="/home" cta="Go to Home" />;

  const canSubmit = photos.length >= MIN_PHOTOS && !submitting && (!job || job.status === "failed");

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Add a room scan</h1>
            <p className="muted">Bring in a 3D view of your room -- upload a file, or scan it right here with your phone.</p>
          </div>
          <div className="scan-mode-tabs" role="tablist" aria-label="Scan method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "upload"}
              className={`scan-mode-tab${mode === "upload" ? " is-active" : ""}`}
              onClick={() => setMode("upload")}
            >
              Upload a file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "capture"}
              className={`scan-mode-tab${mode === "capture" ? " is-active" : ""}`}
              onClick={() => setMode("capture")}
            >
              Scan with your phone
            </button>
          </div>

          {mode === "upload" && (
            <>
              <label className="upload-drop">
                <Icon name="scan" size={36} />
                <span>Choose a .glb file</span>
                <input type="file" accept=".glb" onChange={handleUpload} className="sr-only" />
              </label>
              {status && <StatusPill tone={status.tone}>{status.text}</StatusPill>}
            </>
          )}

          {mode === "capture" && (
            <>
              {!job && (
                <>
                  <label className="upload-drop">
                    <Icon name="camera" size={36} />
                    <span>Take a photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={addPhoto}
                      className="sr-only"
                      disabled={submitting}
                    />
                  </label>
                  {photos.length > 0 && (
                    <ul className="phone-scan-thumbs">
                      {photoUrls.map((url, i) => (
                        <li key={url} className="phone-scan-thumb">
                          <img src={url} alt={`Photo ${i + 1}`} />
                          <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(i)}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="muted small">
                    {photos.length}/{MIN_PHOTOS}+ photos -- walk around the room, overlapping each shot with the last.
                  </p>
                  <div className="row wrap">
                    <button className="primary-button" onClick={submitCapture} disabled={!canSubmit}>
                      {submitting ? "Starting..." : `Reconstruct room from ${photos.length} photos`}
                    </button>
                    <StatusPill title="Real cost, charged to your Reali3 account">Uses 1 Reali3 credit (~$0.50)</StatusPill>
                  </div>
                  {captureError && <StatusPill tone="danger">{captureError}</StatusPill>}
                </>
              )}
              {job && job.status !== "completed" && (
                <StatusPill tone="neutral">
                  {job.status === "pending" ? "Starting reconstruction..." : `Reconstructing... ${job.progress}%`}
                </StatusPill>
              )}
              {job?.status === "failed" && (
                <>
                  <StatusPill tone="danger">Reconstruction failed. You can try again with the same photos.</StatusPill>
                  <button className="primary-button" onClick={() => setJob(null)}>
                    Try again
                  </button>
                </>
              )}
            </>
          )}
        </>
      }
    >
      <GlassCard as="section" className="stack">
        <h2>{mode === "upload" ? "How to scan" : "How this works"}</h2>
        <ol className="steps">
          {mode === "upload" ? (
            <>
              <li>Open a LiDAR scanning app and walk the room slowly.</li>
              <li>Export the result as a .glb file.</li>
              <li>Upload it here. It becomes the 3D view of your room.</li>
            </>
          ) : (
            <>
              <li>Take at least {MIN_PHOTOS} photos, walking around the room and overlapping views.</li>
              <li>We send them to a photogrammetry service that reconstructs a real 3D mesh.</li>
              <li>Once it's done, it becomes the 3D view of your room -- same as an uploaded scan.</li>
            </>
          )}
        </ol>
      </GlassCard>
    </Zones>
  );
}
