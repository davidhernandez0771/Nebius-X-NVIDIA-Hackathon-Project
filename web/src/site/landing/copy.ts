// Landing copy, from T1's content spec (docs/design/content-spec.md §3, sprint 9, commit deb5dfb on
// pm/web-review). Every number is in the spec's fact registry; the IDs (R1, B2, …) and the notes they
// come from are kept next to the copy that shows them. Change a number in the registry first.

/** Where "Try it" / "Power on" crosses into the app (spec §2: Record is /pm/record today). */
export const RECORD_ROUTE = "/pm/record";

export const nav = {
  links: [
    { to: "/site#how", label: "How it works" },
    { to: "/site/results", label: "Results" },
    { to: "/robots", label: "Robots" },
  ],
  cta: { to: RECORD_ROUTE, label: "Try it" },
};

/** Beat 0. */
export const hero = {
  title: "Show a robot once. Get the data to teach it.",
  lede: "Do a task with your hand in front of a webcam. SANT replays it on a simulated robot, checks it in real physics, fixes it, multiplies it and labels it. Out comes robot training data.",
  cta: "Try it",
  secondary: "See the proof",
  brand: "Simulate · Augment · Neaten · Train. Perfect, then multiply.",
  // The canvas is a picture of the idea, not of data: no real-hand video exists yet (A2).
  label: "A hand slowly pinches. Small robot grippers copy the pinch a moment later and double with every pinch, from one copy to many.",
};

/** Beat 1: P1–P7. */
export const problem = {
  title: "Robots learn from demonstrations. Nobody has enough.",
  body: [
    "A robot learns a task by copying examples, and it needs a great many.",
    "The usual way to make them is teleoperation: a person drives the robot through the task. Rigs cost $6k–$80k, operators $25–$50 an hour, and 20–30% of demos get thrown away.",
  ],
  estimates: "Vendor estimates.",
  labs: {
    title: "So the biggest labs are learning from human video.",
    rows: [
      { who: "Tesla", what: "Optimus learns from videos of people doing the work." },
      { who: "Figure", what: "Project Go-Big trains on human video at internet scale." },
      { who: "NVIDIA", what: "GR00T-Mimic multiplies a few demos; GR00T-Dreams generates new ones with a video model." },
    ],
  },
  gap: {
    title: "Video has no physics.",
    body: "A video shows a hand, not the grip, the weight or the contact. A generated video can show a cube floating into a bin. A robot trained on that learns the wrong thing.",
  },
  sources: "Costs: vendor estimates in the design spec (spec:33–35). The labs: what each is doing, from the sprint 9 plan; no figures are ours.",
};

/** Beat 2: V1, V4, Y1, Y2. */
export const how = {
  title: "How SANT works",
  steps: [
    {
      name: "Show",
      title: "Do it once, with your hand.",
      body: "Your browser tracks your hand and a simulated robot in NVIDIA Isaac Lab copies it. A webcam is all you need.",
    },
    {
      name: "Review",
      title: "Physics checks it. Nemotron reads it.",
      body: "Isaac Lab replays the demo: if the cube doesn't end up in the bin, it doesn't count. Code measures every move and fixes shakes, pauses and idle time from a fixed menu. Nemotron writes what the demo shows, and checks it is what you meant (coming next).",
      fact: "One synthetic demo, before and after repair: 13.8 s → 9.3 s, and both replays succeeded.",
      source: "t1-status.md:1500; the demo is the scripted expert with flaws added on purpose (media README:15–17)",
    },
    {
      name: "Get",
      title: "One demo becomes a dataset.",
      body: "New cube and bin positions; every copy is replayed and verified again; only verified copies are kept, labeled, and exported for training in LeRobot format.",
      fact: "10 sources × 10 variants: 100/100 verified. A bigger set, 10 × 30: 300/300 verified.",
      source: "t2-status.md:892, 898 and 1109, 1119",
    },
  ],
  matrix: {
    caption: "A frame of a demo replayed in Isaac Lab, turning into data as you scroll.",
    label: "A robot arm grasping a red cube, seen by the front camera, dissolving from a photo into a grid of square dots.",
  },
};

/** Beat 3: R1–R3, R5, R16–R18; C1–C4. */
export const proof = {
  title: "Same 10 demos. Multiplied, the robot succeeded 17 times out of 40 instead of 3.",
  tiles: { from: 7.5, to: 42.5, label: "task success, same 10 demos: 3/40 → 17/40" },
  arms: [
    { label: "The 10 demos alone", k: 3, n: 40, ciLow: 2.6, ciHigh: 19.9 },
    { label: "+ 100 verified copies", k: 17, n: 40, ciLow: 28.5, ciHigh: 57.8 },
    { label: "+ 300 verified copies", k: 16, n: 40, ciLow: 26.3, ciHigh: 55.4 },
  ],
  p: "0.0005 for 100 copies and 0.0012 for 300, each against the 10 demos alone",
  scenes: "On 40 new scenes, chosen before the test and never used to pick anything. 95% confidence intervals 3–20%, 28–58% and 26–55%.",
  plateau: "Tripling the copies didn't help at the same training budget: 16/40 vs 17/40.",
  limitsTitle: "What it does not show yet",
  limits: [
    "The 10 demos came from a scripted expert, not a person, and needed no repair: this tests multiplying, not perfecting. Human demos come next.",
    "One task, one simulated arm, one policy type, one training run per arm.",
    "Equal training steps, not equal epochs.",
    "It still mostly fails by dropping the cube.",
  ],
  source: "t3-status.md:1156–1177 (sprint 7) and 1307–1325 (sprint 8)",
  more: { to: "/site/results", label: "See every run and how we tested" },
};

/** Beat 4: B1–B5. */
export const robot = {
  title: "Bring your robot. Find out if it can do the job before you build it.",
  body: "Load your robot's model (a URDF), mark its base, hand and gripper, and run the same workflow. SANT gives you training data for that robot, and a report card: what it can reach, how often it succeeds, and why it fails.",
  example: "OpenArm couldn't place a single copy: 0 of 30. Its wrist turns only ±45°, so it can grasp straight down only inside a band about 0.2 m tall. The simulator found that before anyone built a cell around it.",
  shelf: [
    { name: "Franka Panda", note: "Our main robot", sticker: "Tested" },
    { name: "OpenArm", note: "0 of 30", sticker: "Design flaw found" },
    { name: "Flexiv Rizon 4s", note: "9 of 30; its gripper model lets the cube slip", sticker: "Tested" },
  ],
  status: "Coming next. Upload and part roles are a preview.",
  source: "t2-status.md:310–311, 368, 513, 528–529",
  more: { to: "/robots", label: "See the robots" },
};

/** Beat 5: N1, N2, N5, N6; L1–L3. */
export const nemotron = {
  title: "Physics decides if it works. Nemotron decides if it's what you meant.",
  cards: [
    {
      title: "Measured: as a visual judge, code beat it.",
      body: "In a pre-registered test on 32 synthetic demos, code alone scored F1 0.90 and rules + Nemotron 0.86. Without the measured grasp offset, the model called all 8 centered grasps off-center. So code and physics judge the motion.",
      source: "t4-status.md:1323, 1329, 1336",
    },
    {
      title: "Measured: it understands what people ask for.",
      body: "“Don't trim the end, just remove the pauses.” Nemotron turned 34 of 34 such requests into the right repairs; a keyword parser got 31. A small test (not significant, p = 0.25).",
      source: "t4-status.md:1504, 1526, 1540–1541",
    },
  ],
  next: "Next: Nemotron writes each demo's label and checks it against your request. Robot models that follow instructions train on a demo plus its sentence. Not built yet; it will be tested before we claim it works.",
  cost: "Runs on Nebius Token Factory, at about $0.0002 per request.",
  costSource: "t4-status.md:1536",
};

/** Beat 6. */
export const tryIt = {
  title: "Your hand. A webcam. A robot that copies you.",
  body: "Record a demo in your browser. Nothing is sent anywhere until you press Start camera; the camera asks for permission only then.",
  pinch: { title: "Try a pinch.", body: "Grab the sheet and drag it. On the next page your hand does this to a robot gripper." },
  cta: "Power on",
  // The small print links the RUNBOOK, so it lives in LandingPage.tsx.
};

export const REPO = "https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project";
