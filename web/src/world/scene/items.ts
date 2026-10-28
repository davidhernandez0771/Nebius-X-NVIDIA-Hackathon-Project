// The jobs on the spiral: one cartridge per thing SANT does, with honest numbers only (the prototype's
// ITEMS, docs/design/prototypes/site-journey.html; anything not finished says "pending"). Each has a
// tag, which the filters and Ask SANT use, and the 2D route its plug-in opens (Record for now: the
// brief's "the real Record page opens as the window").

export const TAGS = [
  { id: "record", label: "record a demo" },
  { id: "perfect", label: "perfect it" },
  { id: "multiply", label: "multiply" },
  { id: "train", label: "train" },
  { id: "robot", label: "bring your robot" },
  { id: "results", label: "results" },
] as const;

export type TagId = (typeof TAGS)[number]["id"];

export interface Item {
  id: string;
  /** Printed large on the label. */
  title: string;
  /** The small line under it. */
  sub: string;
  tag: TagId;
  /** Which robot or model it is about. */
  robot: string;
  /** One honest sentence. */
  desc: string;
  route: string;
}

const item = (title: string, sub: string, tag: TagId, robot: string, desc: string): Item => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  sub,
  tag,
  robot,
  desc,
  route: "/pm/record",
});

export const ITEMS: readonly Item[] = [
  item("RECORD", "webcam → robot", "record", "FR3", "Show the task once with your hand. The webcam drives the robot twin live."),
  item("HAND LOCK", "one hand, no flicker", "record", "FR3", "Once a hand is picked, every other hand is ignored. Steady 0.3 s to lock, 0.7 s hold."),
  item("PINCH GRIP", "pinch = close", "record", "FR3", "Pinch to close the gripper, open to let go. Hold an open palm 1.5 s to reset the scene."),
  item("LIVE TWIN", "robot twin · 30 hz", "record", "FR3", "A browser twin of the robot mirrors the sim joints while you record."),
  item("PHYSICS CHECK", "isaac lab replay", "perfect", "FR3", "Every demo is replayed in Isaac Lab. If the cube does not end in the bin, it does not count."),
  item("GRASP FIX", "centered approach", "perfect", "FR3", "Drops came from an off-center approach. The fix centers the gripper before it closes: 20/40 vs 17/40."),
  item("DROP FINDER", "where it slipped", "perfect", "FR3", "Finds the exact step where the cube left the gripper."),
  item("NEATEN", "trim + smooth", "perfect", "FR3", "Trims hesitation and jitter from the human demo before it is multiplied."),
  item("10 × 10", "100 variants", "multiply", "FR3", "One demo becomes 100: new cube and bin positions, each checked in physics."),
  item("10 × 30", "300 variants", "multiply", "FR3", "Three times more copies: 16/40 vs 17/40. Quality of copies beats count."),
  item("RANDOMIZE", "layout per copy", "multiply", "FR3", "Every copy gets a new layout; the task stays the same."),
  item("VERIFY ALL", "keep successes", "multiply", "FR3", "Only copies that succeed in physics become training data."),
  item("ACT 30K", "imitation policy", "train", "FR3", "An ACT policy trained on the multiplied demos for 30k steps."),
  item("ACT 60K", "run 2 · pending", "train", "FR3", "Longer training with recovery copies. The run is staged, not finished."),
  item("RECOVERY", "learn to re-grasp", "train", "FR3", "Copies that start from a slip, so the policy learns to recover."),
  item("EVAL 40", "unseen seeds", "train", "FR3", "Every policy is tested once, pre-registered, on 40 scenes it has never seen."),
  item("BRING ROBOT", "urdf → report card", "robot", "ANY", "Upload a URDF. SANT builds the scene and prints a report card."),
  item("FRANKA", "30 / 30", "robot", "FR3", "Franka through the URDF path: 30/30."),
  item("OPENARM", "0 / 30 · report", "robot", "OPENARM", "OpenArm through the same path: 0/30. The report card shows where it fails."),
  item("SO-101", "next up", "robot", "SO-101", "Next robot on the list."),
  item("3 / 40", "raw demos", "results", "FR3", "Policy trained on raw demos only: 3/40 on unseen seeds."),
  item("17 / 40", "multiplied", "results", "FR3", "Same policy on multiplied demos: 17/40 (p = 0.0005 vs raw)."),
  item("40 / 40", "nemotron labels", "results", "NEMOTRON", "Nemotron labeled 40/40 episodes right (code: 39/40)."),
  item("59 / 60", "nemotron judge", "results", "NEMOTRON", "As a success judge Nemotron got 59/60, no better than a code check. Physics decides."),
];

/** The label's accent per tag (status square and stripe). */
export const TAG_COLOR: Record<TagId, string> = {
  record: "#19f5c2",
  perfect: "#e9e5da",
  multiply: "#ffb000",
  train: "#ff5a1f",
  robot: "#8fb7ff",
  results: "#ffffff",
};

/** The shell's plastic per tag (sRGB). */
export const TAG_SHELL: Record<TagId, string> = {
  record: "#0e5a4b",
  perfect: "#cfc9bb",
  multiply: "#1d1f21",
  train: "#56595b",
  robot: "#2e353c",
  results: "#121416",
};

export const tagLabel = (t: TagId) => TAGS.find((x) => x.id === t)!.label;
export const isTag = (t: unknown): t is TagId => TAGS.some((x) => x.id === t);
export const itemIndex = (id: string) => ITEMS.findIndex((i) => i.id === id);
