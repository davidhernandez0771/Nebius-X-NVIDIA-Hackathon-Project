# Review page: the recorded example

The demo `/review2` shows when no backend is running (and at `/review2?id=example`).

- **What it is:** `s1_0002` (raw, 13.76 s) and `s1_0002_rules` (the rules' repair of it, 9.32 s), the same pair
  as `docs/media/s1_0002_raw_vs_perfected.gif`. Both replays succeeded in Isaac Lab.
- **It is synthetic:** the scripted expert with tremor, pauses, slowness and idle time added on purpose
  (`docs/media/README.md`). No real webcam demo is in it.
- **Where it came from:** the local demo store `C:\dev\pm-t4\data\demos\s1_0002` and `s1_0002_rules`
  (T4's s1 run, 2026-10-16), exported with

  ```
  python scripts/export_review_example.py --store C:\dev\pm-t4\data\demos --raw s1_0002 --perfected s1_0002_rules --out web/src/site/review/example
  ```

- **What was changed:** nothing in the values. The trajectory keeps every 5th step (and the last); the front
  camera keeps every 10th frame (one every 0.2 s at 50 fps, and the last), packed into one JPEG sheet per demo.
- **Files:**
  - `example.json`: both demos, both stored diagnoses (`s1_0002_rules/diagnosis.json` is the rules diagnosis
    the repair came from; `s1_0002/diagnosis.json` is the sprint 3 Nemotron's, which found no issues), both
    passports with their physics verification, and the frame-sheet layout;
  - `raw_front.jpg`, `perfected_front.jpg`: the frame sheets.
