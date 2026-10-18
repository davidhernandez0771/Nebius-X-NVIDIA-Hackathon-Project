# The Review verdict card: "Physics: verified ✓ / Nemotron label / Matches"

**The roles, in one line:**
- **Physics** (an Isaac Lab replay) says whether a demo **works**.
- **Nemotron 3.5 Super VL** says what the person **did** (the label), and whether a physics-checked copy still does
  **what they meant** (the match).

**This page is the contract** between the backend and the Review page's verdict card (T1, `web/src/site/review/**`).
- **Code:** `review_verdict()` and `ReviewVerdict` in `src/demo_pipeline/intent.py` compose the card (tests in
  `tests/test_intent.py`).
- **The two Nemotron calls** are in `src/app/ai/intent.py`.
- **The measurements** behind every rule below are in `docs/superpowers/notes/2026-10-18-nemotron-judge.md`.

## The card

```
┌───────────────────────────────────────────────────────────────┐
│ Physics      verified ✓                  (or: failed ✗ · reasons) │
│ Nemotron     "The robot picks up a red cube and places it      │
│               inside a blue bin."   reach · grasp · carry · release │
│ Matches      yes — Both pick up the red cube and drop it in    │
│              the blue bin; the copy's last frame shows it there. │
└───────────────────────────────────────────────────────────────┘
```

**The rules** (each one follows from the measured results):
1. **Physics decides success. Always.**
   - Nemotron's own idea of the outcome (`copy_completes`) never turns a failed check into a pass, or a pass into a
     fail.
   - Its one wrong verdict in the test was a hallucinated success: an empty bin it described as "the cube inside the
     container", at 0.95 confidence.
2. **"Matches" is shown only for a copy that passed physics.** A failed copy is not kept, so its match is
   `not_checked`.
3. **A disagreement is said out loud, not hidden.**
   - When Nemotron and physics disagree about the outcome, `conflict` holds one sentence, ending "physics
     decides".
   - The card shows it under the match line, in the issue tone (amber), with text.
4. **No confidence is shown.** The model's confidence was 0.95–0.98 on nearly every reply, the wrong one included,
   so it carries no signal. `ReviewVerdict` drops it on purpose.
5. **"Unavailable" is never shown as "no".**
   - A model error or timeout makes the label or the match `unavailable`.
   - The physics line still shows. Nothing is inferred.
6. **The reason is shown verbatim.** It is the model's one or two sentences, which a person can check against the
   frames. Don't paraphrase it, and don't truncate it below two lines.

## The data: `ReviewVerdict`

```jsonc
{
  "physics": {
    "status": "verified" | "failed",
    "reasons": ["not_in_bin", "dropped", ...]      // empty when verified; success.py's reason codes
  },
  "label": {
    "status": "ok" | "unavailable",
    "task": "The robot picks up a red cube and places it inside a blue bin.",   // null when unavailable
    "object": {"name": "cube", "color": "red"},     // the object that is moved
    "destination": "bin" | "table" | "unknown",     // where that object ends up
    "steps": [                                       // always reach, grasp, carry, release, in order
      {"name": "reach",   "frames": [0, 119]},       // first and last episode frame, inclusive
      {"name": "grasp",   "frames": [120, 145]},
      {"name": "carry",   "frames": [146, 349]},
      {"name": "release", "frames": [350, 457]}
    ],
    "error": null                                    // why it is unavailable
  },
  "match": {
    "status": "yes" | "no" | "not_checked" | "unavailable",
    "checks": {                                      // null unless status is yes or no
      "same_object": true,     // same kind of object, same colour
      "same_goal": true,       // ends in the same kind of place
      "same_order": true,      // picked up where the human picked it up, let go where they let go
      "copy_completes": true   // the copy's last frame shows the object at the goal
    },
    "reason": "Both demos move the same red cube into the same blue container ..."
  },
  "conflict": null             // or: "Nemotron says the copy completes the task, but the physics check failed; physics decides."
}
```

**For the web side,** the same contract as a type:

```ts
type StepName = "reach" | "grasp" | "carry" | "release";
type ReviewVerdict = {
  physics: { status: "verified" | "failed"; reasons: string[] };
  label: {
    status: "ok" | "unavailable";
    task: string | null;
    object: { name: string; color: string | null } | null;
    destination: "bin" | "table" | "unknown" | null;
    steps: { name: StepName; frames: [number, number] }[];
    error: string | null;
  };
  match: {
    status: "yes" | "no" | "not_checked" | "unavailable";
    checks: { same_object: boolean; same_goal: boolean; same_order: boolean; copy_completes: boolean } | null;
    reason: string | null;
  };
  conflict: string | null;
};
```

## What each line says (copy for the card)

| State | Physics line | Nemotron line | Matches line |
|---|---|---|---|
| The human demo, verified | **Physics** verified ✓ | the `task` sentence; steps as four ticks on the timeline | *(hidden: nothing to compare with; `not_checked`)* |
| A copy, verified, matches | **Physics** verified ✓ | the `task` sentence | **Matches** yes, then the `reason` |
| A copy, verified, doesn't match | **Physics** verified ✓ | the `task` sentence | **Matches** no, then the failed check names in words ("different object", "different goal", "steps reversed", "didn't finish") and the `reason` |
| A copy, physics failed | **Physics** failed ✗, then the reasons in words ("dropped the cube", "not in the bin") | the `task` sentence | **Matches** not checked: the physics check failed, so this copy is not kept |
| Model error or timeout | unchanged | "Nemotron label unavailable." | "Match unavailable." No guess |
| Any `conflict` | unchanged | unchanged | the `conflict` sentence under the match line, in the issue tone (amber) |

**The words for the checks:**
- `same_object` false → "different object";
- `same_goal` false → "different goal";
- `same_order` false → "steps reversed";
- `copy_completes` false → "didn't finish".

**The steps** map onto the Review timeline as four bands. Their frames are episode frames: divide by the
episode's fps for seconds.

## What the numbers support (cite these, nothing stronger)

All of these come from the pre-registered test in `2026-10-18-nemotron-judge.md` ("Results"): 40 label clips and
60 judge pairs from sim recordings, 128 px frames.
- **Labeler:** task (object colour + destination) **40/40** (95% CI 91.2–100%). A pixel-rule baseline scored 39/40
  (p = 1.0).
  - **Steps:** 40/40, but **they are copied from the gripper log**. Code gets them exactly.
- **Judge:** **59/60** (91.1–99.7%); the code rule scored 60/60 (p = 1.0).
  - Different object: 10/10. Different goal: 10/10. Matching pairs: 30/30.
  - A failed copy labelled as passed: 9/10.
- **So:** "no detectable difference from a simple code rule on this set". The code rule matched or beat Nemotron
  on the judge.
  - Do not write that Nemotron "detects failures" or "beats rules".
  - Do write that it "labels what was done and explains the match in words".
- **The limits:** no real person's demo, no webcam video, a single task, and one run per item.
- **Cost and speed:** about **$0.001 per call** (8 images at 256 px, about 2.9k prompt tokens) and **about 1.5 s**.
  A demo with one copy needs 2 calls (label + judge).

## Inputs (for the backend)

- **Labeler:**
  - up to 8 front-camera frames, evenly spaced with the first and last included, each captioned "image n = frame
    f (t s)";
  - plus the trajectory summary: gripper close and open frames, hand start and end, heights, path length.
  - The prompt names no object, colour or task.
- **Judge:**
  - 4 frames of the human demo and 4 of the copy, with both summaries;
  - the copy's physics label, which the prompt says to check, not trust.
- **Model and settings:** `nvidia/Nemotron-3.5-Super-VL` on Nebius Token Factory; thinking off, temperature 0.2,
  `max_tokens` 1024.
- **Replies** are validated against the schema. An invalid reply is retried once with the error, and then the
  card shows `unavailable`.
- **Token Factory refuses more than 8 images in one prompt.**
