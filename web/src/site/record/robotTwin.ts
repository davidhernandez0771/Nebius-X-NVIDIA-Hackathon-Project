// The 3D robot twin on /record (docs/superpowers/notes/2026-10-18-t1-robot-twin.md): live from the sim
// when one is connected; otherwise a replay of the verified copy the world's hologram plays
// (web/public/world/demo-episode.json), so the pane moves with no backend at all.

import { useLiveTwin, useReplayTwin, type LiveTwin, type ReplayTwin, type TwinPose, type TwinState } from "../../twin";

export const DEMO_EPISODE_URL = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/")}world/demo-episode.json`;

export type RecordTwin = {
  mode: "live" | "replay";
  /** What RobotTwin draws. */
  view: TwinState & { base: TwinPose | null };
  /** The line under the view. */
  caption: string;
};

/** Live wins whenever the sim streams poses; the replay is the stand-in, never mixed with live data. */
export function chooseTwin(sim: LiveTwin, replay: ReplayTwin): RecordTwin {
  if (sim.status === "live") {
    const { joints, gripper, cube, bin, base } = sim;
    return { mode: "live", view: { joints, gripper, cube, bin, base }, caption: "live from the sim" };
  }
  const view = { ...replay.twin, base: replay.base };
  if (replay.status === "ready" && replay.episode) return { mode: "replay", view, caption: `replay · verified copy ${replay.episode.demoId}` };
  if (replay.status === "error") return { mode: "replay", view, caption: "no replay: the demo episode didn't load" };
  return { mode: "replay", view, caption: "loading the replay…" };
}

export function useRecordTwin(): RecordTwin {
  const sim = useLiveTwin(); // its own read-only socket: no clash with the page's link, works with the camera off
  const replay = useReplayTwin(null, { url: sim.status === "live" ? null : DEMO_EPISODE_URL });
  return chooseTwin(sim, replay);
}
