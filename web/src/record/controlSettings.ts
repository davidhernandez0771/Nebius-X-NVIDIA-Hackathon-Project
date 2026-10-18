// The Hand control settings' slider ranges and Calibrate-by-hand prompts, shared by the archived
// panel (legacy/pm/record/HandControlPanel.tsx) and the /record settings drawer, so both apply the
// same rules. Moved out of HandControlPanel.tsx unchanged.

import type { CalibrationState } from "./teleop/controlRegion";

export const SIZE_MIN = 0.2; // SANT's slider range; calibration may go a little smaller
export const DEPTH_MIN = 0.03;
export const DEPTH_MAX = 0.3;
export const DEPTH_GAP = 0.01; // far stays at least this far below near

export const STEP_TEXT: Record<CalibrationState["step"], string> = {
  move: "Move your hand slowly around the space you want to use: left, right, up, and down to where the table should be. Keep your whole hand in view.",
  near: "Now hold your hand comfortably close to the camera (the arm reaches forward).",
  far: "Now hold your hand back, away from the camera (the arm pulls back).",
  done: "",
  failed: "",
};
