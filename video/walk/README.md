# The walkthrough video

A narrated screen recording of the real site and the live Isaac Lab run, cut to under 3 minutes for the submission.
The current cut is `edit4.py` with `narration4.json`; `edit.py`…`edit3.py` and their narrations are the earlier cuts.
Everything is written to `video/build/` (git-ignored).

## 1. Record

The browser is a headless Chrome on port 9351 with a fresh profile, driven one step at a time by `cdp.mjs` while
`rec.mjs` films every frame it paints.

```bash
chrome --headless=new --remote-debugging-port=9351 --user-data-dir=<new empty dir> --window-size=1920,1080 --force-device-scale-factor=1.3333334
```

```bash
WALK_DIR=video/build/<take> DPR=1.3333334 QUALITY=100 node video/walk/rec.mjs
```

- `node video/walk/cdp.mjs nav <url>`, then `pan <y> 300` for the story: one constant 300 px/s scroll, so every
  title stays on screen long enough to read. `mark <name>` notes the time of a step.
- An empty `STOP` file in the take's folder stops the recorder.
- `python video/walk/frames2video.py video/build/<take> <take>/story60.mp4` turns the frames into 60 fps video.
- `DPR=1.3333334` films at 2560 x 1440 (74 fps while panning, measured). `DPR=2` (4K) drops to 35 fps, which looks choppy.

The Isaac Lab window is filmed separately by `isaac_rec.sh` (desktop duplication through ffmpeg's `ddagrab`; `gdigrab`
returns stale frames for DX12), with the sink started as `teleop_sink.py --window-quality 2560x1440` for a sharp viewport.

## 2. Voice

```bash
<python with edge-tts> video/tts.py video/walk/narration4.json video/build/walk4/voice
```

One MP3 per line plus each word's timing (for the subtitles). A line the service returns cut short is retried.

## 3. Cut

```bash
python video/walk/edit4.py --4k
```

`sant-walkthrough-v4.mp4` (1080p60) and, with `--4k`, `sant-walkthrough-v4-4k.mp4` (2160p60, subtitles drawn at 4K).
Upload the 4K one to YouTube: 4K uploads get YouTube's higher-bitrate encodes, which look sharper even when watched at 1080p.
Shots, crops and where each line goes are at the top of `edit4.py`. Loudness is set to -14 LUFS in two passes.
