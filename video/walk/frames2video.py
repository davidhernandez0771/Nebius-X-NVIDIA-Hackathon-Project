"""Turn rec.mjs's screencast (frames/*.jpg and frames.jsonl, each frame with the time Chrome painted it) into a
constant 60 fps video: each frame is held until the next one was painted, so the video keeps the page's real timing.

    python video/walk/frames2video.py <walk dir> <out.mp4>
"""
import json
import subprocess
import sys
from pathlib import Path

FF = "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg"


def main():
    walk, out = Path(sys.argv[1]), Path(sys.argv[2])
    rows = [json.loads(line) for line in (walk / "frames.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rows.sort(key=lambda r: r["t"])
    lines = ["ffconcat version 1.0"]
    for r, nxt in zip(rows, rows[1:] + [None]):
        lines.append(f"file '{(walk / 'frames' / r['f']).as_posix()}'")
        lines.append(f"duration {(nxt['t'] - r['t']) if nxt else 1 / 60:.6f}")
    lines.append(f"file '{(walk / 'frames' / rows[-1]['f']).as_posix()}'")  # the concat demuxer drops the last duration otherwise
    listing = walk / "frames.ffconcat"
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    subprocess.run([FF, "-v", "error", "-y", "-safe", "0", "-f", "concat", "-i", str(listing), "-vf", "fps=60,format=yuv420p",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "12", str(out)], check=True)
    print("wrote", out, f"{rows[-1]['t'] - rows[0]['t']:.1f} s from {len(rows)} frames")


if __name__ == "__main__":
    main()
