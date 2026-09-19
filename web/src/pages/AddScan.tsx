import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { uploadFile } from "../api/client";

export default function AddScan() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const [status, setStatus] = useState<string>("");

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    setStatus("Uploading...");
    try {
      await uploadFile(`/api/scans?room_id=${roomId}`, file);
      setStatus("Uploaded.");
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  }

  if (!roomId) return <p>Pick a room from Home first.</p>;

  return (
    <section>
      <h1>Upload a room scan</h1>
      <p>
        Scan your room with a third-party LiDAR app (Polycam, Scaniverse, "3D
        Scanner App") and export as .glb, then upload it here.
      </p>
      <input type="file" accept=".glb" onChange={handleUpload} />
      <p>{status}</p>
    </section>
  );
}
