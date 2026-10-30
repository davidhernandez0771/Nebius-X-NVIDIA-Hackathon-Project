"""Speak narration.json with edge-tts, one MP3 per line, and keep each word's timing for the subtitles.

    <python with edge-tts> video/tts.py [narration.json] [out dir]
        -> <out dir, default video/build/voice>/<scene>_<n>.mp3 + words.json
"""
import asyncio
import json
import sys
from pathlib import Path

import inspect

import edge_tts
import edge_tts.communicate

HERE = Path(__file__).parent
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "build" / "voice"
OUT.mkdir(parents=True, exist_ok=True)
cfg = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "narration.json").read_text(encoding="utf-8"))

# edge-tts always asks for 48 kbps MP3. The service also serves 96 kbps (tested 2026-10-29; 48 kHz and PCM are refused),
# which has fewer of the codec's swishy artifacts. The format is a string inside the library, so swap it in a copy of
# the module's code. Lines here are short enough to come back in one piece, so its bitrate-based offset fix never runs.
FORMAT = cfg.get("format")
if FORMAT:
    src = inspect.getsource(edge_tts.communicate)
    old = '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"'
    if old not in src:
        raise SystemExit("edge-tts changed: can't set the output format")
    exec(compile(src.replace(old, f'"outputFormat":"{FORMAT}"'), edge_tts.communicate.__file__, "exec"), edge_tts.communicate.__dict__)
    edge_tts.Communicate = edge_tts.communicate.Communicate


async def speak(text: str, path: Path) -> list[dict]:
    words = []
    com = edge_tts.Communicate(text, cfg["voice"], rate=cfg["rate"], pitch=cfg.get("pitch", "+0Hz"), boundary="WordBoundary")
    with path.open("wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # offsets are in 100 ns ticks
                words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "w": chunk["text"]})
    return words


async def main() -> None:
    out = {}
    for scene in cfg["scenes"]:
        for n, text in enumerate(scene["lines"]):
            key = f"{scene['id']}_{n}"
            for attempt in range(4):  # the service sometimes drops a request, or ends a stream early
                try:
                    words = await speak(text, OUT / f"{key}.mp3")
                except edge_tts.exceptions.NoAudioReceived:
                    print(key, "no audio, retrying")
                    await asyncio.sleep(2)
                    continue
                if len(words) < 0.9 * len(text.split()):
                    print(key, f"cut short ({len(words)} of {len(text.split())} words), retrying")
                    await asyncio.sleep(2)
                    continue
                out[key] = {"text": text, "words": words}
                break
            else:
                raise SystemExit(f"{key}: no audio after 4 tries")
            print(key, len(out[key]["words"]), "words")
    (OUT / "words.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


asyncio.run(main())
