# The demo film

SANT's demo video (2:55, 1920×1080, 30 fps), drawn by the site itself at `/film` from the project's own data and
rendered frame by frame. Every robot shot is a replay of something Isaac recorded: the mouse demos, the webcam demo,
the 100 multiplied copies (Isaac Sim's own camera frames), the teacher's gate run, and the final test's 40 runs.

## Build it

From the repo root, with the site's dev server on :5199 (`npm --prefix web run dev -- --port 5199 --strictPort`):

```
python video/build_demo_replays.py            # 10 mouse demos + the 927 N webcam demo → video/data/demos
python video/build_film_data.py               # → web/public/film: demos, 100 variants + camera atlases
<edge-tts python> video/tts.py                # narration.json → build/voice/*.mp3 + word timings
python video/build_timeline.py                # → web/public/film/timeline.json + build/voice.wav + voice.mp3
node video/render.mjs http://localhost:5199 video/build/picture.mp4
python video/mux.py video/build/picture.mp4 video/build/sant-demo.mp4
```

- **The data scripts** read the data store (`C:/dev/pm-t6/data`, read-only) and need numpy and Pillow; the Isaac
  venv has both.
- **`tts.py`** needs `edge-tts`. It was installed in a scratch venv, not the project.
- **To check a frame or a stretch:**
  - `STILLS="3,40.5" node video/render.mjs <url> <dir>` writes PNGs at those times.
  - `/film?t=40` in a browser plays it with the voice (Space plays; the arrow keys step).

## What's in it

The voice is `narration.json`, read by an AI voice (edge-tts, en-US-AndrewNeural), with burned-in subtitles timed to
its words.

| # | Scene | Picture |
|---|---|---|
| 0 | Open | The 10 mouse demos (Isaac's camera) → copied directly 0/40 → the final test's 40 runs drawn from above, counting to 30/40 |
| 1 | The problem | Expensive demos; a mouse demo replayed with its hand speed (the pauses); the webcam demo pressing 927 N against the 5 N limit |
| 2 | Where SANT fits | Cheap demos → SANT → demos that work → Isaac Lab Mimic → training; S·A·N·T and the stack |
| 3 | How it works | Record, Check (Pass), Repair (rules or Nemotron, re-checked), Multiply (100 copies, Isaac's camera) |
| 4 | Nemotron on Nebius | A real logged scene plan (2 calls, $0.0011); 483 calls, about $1.14 in all |
| 5 | Why it works | Copying stalls (0/40, 3/40); the RL teacher (4,096 arms; a real gate run); 0/128 vs 113/128; 1.7 m/s → 3/50, capped → 50/50 |
| 6 | The test | The final test's seed 5401; the climb 0 → 3 → 15 → 30 with the goal of 24; the 10 failures, all drops |
| 7 | Close | What it doesn't show; the logo; credits and the repo |

**Robot footage:** about 70 s of the arm moving: the replays in scenes 1, 3, 5 and 6, the 100 copies on Isaac's camera, and the open's camera tiles.

**Where the numbers come from:**
- The README's "The headline result" (0/40, 3/40, 15/40, 30/40, CI 60–86%, 0/128 vs 113/128) and its notes.
- README "Physics check, as recorded" (927 N, 5 N, 0/10).
- The mouse result row (10/10 passed as recorded, 100/100 variants).
- The Mimic row (9 of 100).
- The RL teacher row (1.7 m/s, 3/50, 0.5 m/s, 50/50).
- The Token Factory usage (483 calls, about $1.14).

**What it doesn't say:**
- that Nemotron made the 30/40;
- a p-value between rows tested on different seeds;
- anything about a real robot.
