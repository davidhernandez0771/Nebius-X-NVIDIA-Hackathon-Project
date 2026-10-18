// Sizes shared by the live cloth and the still print, so both sit in the box the same way.

/** 32 x 20 = 640 particles/vertices: enough for soft folds, cheap to step and draw. */
export const SHEET = { cols: 32, rows: 20, width: 2.4, height: 1.5 } as const;

export const CAMERA_FOV = 30;
/** Space around the sheet at rest, as a fraction of its size: room to pull it into. */
export const SHEET_MARGIN = 0.28;
/** The share of the box's limiting side that the resting sheet covers. */
export const SHEET_FILL = 1 / (1 + SHEET_MARGIN);

/** World units around the pointer within which a cloth particle can be picked up. */
export const PICK_RADIUS = 0.11;
/** How far a pinch lifts the held point toward the viewer. */
export const PINCH_LIFT = 0.16;
/** How far from its rest position the held point can be pulled (keeps it in the box). */
export const MAX_PULL = 0.62;
