"""Lay the voice lines on the film's clock and mix the voice track.

    python video/build_timeline.py   (after tts.py) -> web/public/film/timeline.json, video/build/voice.wav,
                                                       web/public/film/voice.mp3 (for the page's preview playback)
"""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
FF = Path("C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin")
VOICE = HERE / "build" / "voice"
FILM = HERE.parent / "web" / "public" / "film"
GAP = 0.35  # between lines in a scene
# seconds of picture before a scene's first line and after its last
PAD = {"open": (1.2, 0.7), "problem": (0.5, 0.6), "stack": (0.5, 0.7), "pipeline": (0.4, 0.6), "nemotron": (0.4, 0.6),
       "teacher": (0.4, 0.6), "test": (0.4, 1.0), "close": (0.4, 3.2)}


def length(p: Path) -> float:
    out = subprocess.run([str(FF / "ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


cfg = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
words = json.loads((VOICE / "words.json").read_text(encoding="utf-8"))
t, scenes, clips = 0.0, [], []
for s in cfg["scenes"]:
    lead, tail = PAD[s["id"]]
    start = t
    t += lead
    lines = []
    for n, text in enumerate(s["lines"]):
        key = f"{s['id']}_{n}"
        d = length(VOICE / f"{key}.mp3")
        lines.append({"key": key, "start": round(t, 3), "end": round(t + d, 3), "text": text,
                      "words": [{"t": round(t + w["t"], 3), "d": round(w["d"], 3), "w": w["w"]} for w in words[key]["words"]]})
        clips.append((VOICE / f"{key}.mp3", t))
        t += d + GAP
    t += tail - GAP
    scenes.append({"id": s["id"], "start": round(start, 3), "end": round(t, 3), "lines": lines})
timeline = {"fps": 30, "width": 1920, "height": 1080, "duration": round(t, 3), "scenes": scenes}
FILM.mkdir(parents=True, exist_ok=True)
(FILM / "timeline.json").write_text(json.dumps(timeline, indent=1), encoding="utf-8")

args = [str(FF / "ffmpeg"), "-y", "-v", "error"]
for p, _ in clips:
    args += ["-i", str(p)]
chains = [f"[{i}:a]adelay={round(at * 1000)}:all=1[a{i}]" for i, (_, at) in enumerate(clips)]
mix = "".join(f"[a{i}]" for i in range(len(clips)))
graph = ";".join(chains) + f";{mix}amix=inputs={len(clips)}:normalize=0,apad=whole_dur={t:.3f}[out]"
args += ["-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-ac", "2", str(HERE / "build" / "voice.wav")]
subprocess.run(args, check=True)
subprocess.run([str(FF / "ffmpeg"), "-y", "-v", "error", "-i", str(HERE / "build" / "voice.wav"), "-b:a", "128k", str(FILM / "voice.mp3")], check=True)
print(f"duration {t:.2f} s")
for s in scenes:
    print(f"  {s['id']:9} {s['start']:7.2f} -> {s['end']:7.2f}  ({s['end'] - s['start']:.1f} s)")
