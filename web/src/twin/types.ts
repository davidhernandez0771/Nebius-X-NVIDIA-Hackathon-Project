// The robot twin's data, in the sim's env frame: metres, z up, the Franka's base at the origin
// (sim_worker/robots.py base_pos). Orientations are (w, x, y, z), as the sim writes them.

export type Vec3 = [number, number, number];
export type QuatWxyz = [number, number, number, number];

export type TwinPose = { pos: Vec3; quat: QuatWxyz };

/** What the twin draws. A null part is left out; with no joints the robot stands in its start pose. */
export type TwinState = {
  joints: Record<string, number> | null;
  /** The gripper the sim was sent: 0 open, 1 closed (drawn in the needle colour). */
  gripper: 0 | 1 | null;
  cube: TwinPose | null;
  bin: TwinPose | null;
};

export const EMPTY_TWIN: TwinState = { joints: null, gripper: null, cube: null, bin: null };
