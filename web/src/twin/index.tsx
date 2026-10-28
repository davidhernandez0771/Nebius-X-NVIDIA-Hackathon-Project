// The robot twin, for any page: the 3D view (lazy: three.js and urdf-loader load only when it mounts) and its two
// sources, live from the sim and replays of saved episodes. Mounting notes:
// docs/superpowers/notes/2026-10-18-t1-robot-twin.md.
import { lazy, Suspense } from "react";
import type { RobotTwinProps } from "./RobotTwin";
import "./twin.css";

const View = lazy(() => import("./RobotTwin"));

/** The 3D twin. It fills its box; the page sizes the box. */
export function RobotTwin(props: RobotTwinProps) {
  return (
    <Suspense fallback={<div className="twin3d" aria-busy="true" />}>
      <View {...props} />
    </Suspense>
  );
}

export type { RobotTwinProps, TwinTrail } from "./RobotTwin";
export type { TwinLook } from "./looks";
export { useLiveTwin } from "./useLiveTwin";
export { useReplayTwin, useVerifiedCopies, type ReplayTwin } from "./useReplayTwin";
export { twinSocketUrl, type LiveStatus, type LiveTwin } from "./live";
export type { Episode, EpisodeSummary } from "./replay";
export type { TwinPose, TwinState } from "./types";
export type { TwinObject } from "./messages";
export { COLLISION_MARK, COLLISION_N, barFraction, contactLevel, contactText, type TwinContact } from "./contact";
