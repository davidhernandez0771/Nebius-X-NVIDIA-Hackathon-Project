import type { RobotSummary } from "./types";

/** Rows that fit next to the drop zone at 720 px; the page never scrolls, so the rest is counted, not listed. */
export const LIST_ROWS = 5;

const STATUS: Record<RobotSummary["report_status"], string> = {
  none: "not evaluated",
  queued: "queued",
  running: "running",
  done: "card ready",
  failed: "last run failed",
};

/**
 * The robots to open without uploading: the ones T2's backend already has (newest first), or, when the backend
 * isn't running, the two recorded samples under a "Sample data" tag.
 */
export function RobotList({
  robots,
  sample,
  busy,
  onOpen,
}: {
  robots: RobotSummary[] | null;
  sample: boolean;
  busy: boolean;
  onOpen: (r: RobotSummary) => void;
}) {
  const shown = (robots ?? []).slice(0, LIST_ROWS);
  const more = (robots?.length ?? 0) - shown.length;
  return (
    <section className="byor-list" aria-labelledby="byor-list-title">
      <header className="byor-list__head">
        <h2 id="byor-list-title" className="byor-list__title">
          {sample ? "Sample robots" : "Robots on the backend"}
        </h2>
        {sample && <span className="byor-sample">Sample data</span>}
      </header>
      {robots === null ? (
        <p className="byor-list__note">Asking the backend…</p>
      ) : shown.length === 0 ? (
        <p className="byor-list__note">No robots yet. Upload one to start.</p>
      ) : (
        <ul className="byor-list__rows">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="byor-list__row" disabled={busy} onClick={() => onOpen(r)}>
                <span className="byor-list__name">{r.name}</span>
                <span className="byor-list__score sant-num">
                  {r.headline ? `${r.headline.pick_place}${sample ? " recorded" : ""}` : STATUS[r.report_status]}
                </span>
                <span className="byor-list__meta sant-num">
                  {r.id}
                  {!sample && <>, {r.uploaded_at.slice(0, 10)}</>}
                </span>
                <span className="byor-list__status">{sample ? "T2's recorded run" : r.headline ? STATUS[r.report_status] : r.roles_set ? "roles set" : "roles not set"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="byor-list__note">
          {more} more on the backend (newest are listed).
        </p>
      )}
      {sample && <p className="byor-list__note">The backend isn't running. These are T2's recorded runs; start the backend to set up your own robot.</p>}
    </section>
  );
}
