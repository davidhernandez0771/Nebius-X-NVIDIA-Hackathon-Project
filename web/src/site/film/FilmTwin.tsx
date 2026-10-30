// A recorded run on the robot twin at a given time: the same twin and replay maths as the test track, driven by the
// film's clock instead of a playing one. Every pose is the run's own (Isaac at 50 Hz).
import { useMemo } from "react";
import { RobotTwin, type TwinLook, type TwinTrail } from "../../twin";
import { stateAt, type Episode } from "../../twin/replay";
import type { QuatWxyz, Vec3 } from "../../twin/types";

export type Replayable = Episode & { handPos?: Vec3[] | null; hand?: Vec3[] | null; cubeQuats?: QuatWxyz[] | null };

const TEAL = "#19F5C2";
const CUBE = "#FF8A5C";

/** The step shown at `time` seconds into the run (held on the last step after it ends). */
export const stepOf = (ep: Episode, time: number) => Math.max(0, Math.min(ep.nSteps - 1, Math.floor(time * ep.fps)));

export function FilmTwin({ ep, time, look = "studio", trails = true, className }: { ep: Replayable; time: number; look?: TwinLook; trails?: boolean; className?: string }) {
  const step = stepOf(ep, time);
  const hand = ep.handPos ?? ep.hand ?? null;
  const state = useMemo(() => {
    const s = stateAt(ep, step);
    return ep.cubeQuats && s.cube ? { ...s, cube: { ...s.cube, quat: ep.cubeQuats[step] } } : s;
  }, [ep, step]);
  const frame = useMemo<Vec3[]>(() => [[0, 0, 0], [0, 0, 0.8], ep.bin.pos as Vec3, ...(ep.cubePos ?? []), ...(hand ?? [])], [ep, hand]);
  const lines = useMemo<TwinTrail[] | null>(() => {
    if (!trails) return null;
    const out: TwinTrail[] = [];
    if (hand) out.push({ points: hand, upto: step, color: TEAL });
    if (ep.cubePos) out.push({ points: ep.cubePos, upto: step, color: CUBE });
    return out;
  }, [trails, hand, ep, step]);
  return <RobotTwin {...state} base={ep.base} interactive={false} look={look} cubeColor="red" framePoints={frame} trails={lines} className={className} />;
}
