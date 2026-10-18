import { useRef, useState, type DragEvent } from "react";
import type { Sample } from "./client";
import { UploadIcon } from "./icons";
import type { Issue } from "./types";

const ACCEPT = ".urdf,.zip";

/**
 * The empty state: drop a URDF or a zip with its meshes, pick one, or open a recorded robot. The whole zone is the
 * drop target; the button is the keyboard and touch path.
 */
export function UploadZone({
  onFile,
  onSample,
  busy,
  errors,
  compact = false,
}: {
  onFile: (file: File) => void;
  onSample: (s: Sample) => void;
  busy: boolean;
  errors: Issue[];
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  return (
    <section
      className={`byor-drop${compact ? " byor-drop--compact" : ""}`}
      data-over={over}
      data-busy={busy}
      aria-labelledby="byor-drop-title"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
    >
      <div className="byor-drop__mark" aria-hidden="true">
        <UploadIcon />
      </div>
      <h2 id="byor-drop-title" className="byor-drop__title">
        {busy ? "Reading your robot…" : over ? "Drop to upload" : "Drop your robot's URDF here"}
      </h2>
      <p className="byor-drop__hint">
        A <code>.urdf</code>, or a <code>.zip</code> with the URDF and the STL, OBJ or DAE meshes it names. Run{" "}
        <code>xacro</code> first if you have a <code>.xacro</code>.
      </p>
      <div className="byor-drop__actions">
        <button type="button" className="sant-btn sant-btn--primary sant-btn--md" disabled={busy} onClick={() => input.current?.click()}>
          Choose a file
        </button>
        <span className="byor-drop__or">or open a recorded robot</span>
        <button type="button" className="sant-btn sant-btn--secondary sant-btn--md" disabled={busy} onClick={() => onSample("openarm")}>
          OpenArm
        </button>
        <button type="button" className="sant-btn sant-btn--secondary sant-btn--md" disabled={busy} onClick={() => onSample("franka")}>
          Franka
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      {errors.length > 0 && (
        <ul className="byor-issues" role="alert">
          {errors.map((e) => (
            <li key={e.code + e.message} className="byor-issue" data-severity={e.severity}>
              <code>{e.code}</code> {e.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
