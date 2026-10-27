// The 3D robot twin on /record (docs/superpowers/notes/2026-10-18-t1-robot-twin.md): live from the sim
// when one is connected; otherwise a replay of the verified copy the world's hologram plays
// (web/public/world/demo-episode.json), so the pane moves with no backend at all.
// Live, it also carries the arm's push on the bin or table (the contact glow and force bar) and whether the soft
// floor is holding the target up; a replay has neither.

import { useLiveTwin, useReplayTwin, type LiveTwin, type ReplayTwin, type TwinContact, type TwinObject, type TwinPose, type TwinState } from "../../twin";

export const DEMO_EPISODE_URL = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/")}world/demo-episode.json`;

export type RecordTwin = {
  mode: "live" | "replay";
  /** What RobotTwin draws. */
  view: TwinState & { base: TwinPose | null; contact: TwinContact | null; objects: TwinObject[] | null };
  /** The line under the view. */
  caption: string;
  /** Live only: the soft floor is holding the target up now (null: unknown). */
  floor: boolean | null;
};

/** Live wins whenever the sim streams poses; the replay is the stand-in, never mixed with live data. */
export function chooseTwin(sim: LiveTwin, replay: ReplayTwin): RecordTwin {
  if (sim.status === "live") {
    const { joints, gripper, cube, bin, base, contact, floor, objects } = sim;
    return { mode: "live", view: { joints, gripper, cube, bin, base, contact, objects }, caption: "live from the sim", floor };
  }
  const view = { ...replay.twin, base: replay.base, contact: null, objects: null };
  if (replay.status === "ready" && replay.episode) return { mode: "replay", view, caption: `example replay · verified demo ${replay.episode.demoId}`, floor: null };
  if (replay.status === "error") return { mode: "replay", view, caption: "no replay: the demo episode didn't load", floor: null };
  return { mode: "replay", view, caption: "loading the replay…", floor: null };
}

export function useRecordTwin(): RecordTwin {
  const sim = useLiveTwin(); // its own read-only socket: no clash with the page's link, works with the camera off
  const replay = useReplayTwin(null, { url: sim.status === "live" ? null : DEMO_EPISODE_URL });
  return chooseTwin(sim, replay);
}
