"""Put the sound on the rendered picture: the voice (build/voice.wav), a quiet synthesized drone under it (ducked
while the voice speaks) and a soft swell at each scene change, loudness-normalized for YouTube.

    python video/mux.py build/picture.mp4 build/sant-demo.mp4
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
FF = "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg"
picture, out = Path(sys.argv[1]), Path(sys.argv[2])
tl = json.loads((HERE.parent / "web/public/film/timeline.json").read_text(encoding="utf-8"))
D = tl["duration"]

# the drone: A and E, slowly breathing, low-passed, with a little room
drone = ("aevalsrc='"
         "0.30*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.05*t))"
         "+0.22*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.071*t+1))"
         "+0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.043*t+2))"
         "+0.08*sin(2*PI*164.81*t)*(0.5+0.5*sin(2*PI*0.031*t+3))"
         f"':s=48000:d={D:.3f}")
bed = HERE / "build" / "bed.wav"
subprocess.run([FF, "-y", "-v", "error", "-f", "lavfi", "-i", drone, "-af",
                f"lowpass=f=700,aecho=0.8:0.7:120|260:0.25|0.18,afade=t=in:d=3,afade=t=out:st={D - 3.5:.3f}:d=3.5,volume=0.22,aformat=channel_layouts=stereo",
                str(bed)], check=True)

# a soft noise swell into each scene change
swell = HERE / "build" / "swell.wav"
subprocess.run([FF, "-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=color=pink:d=1.2:a=0.5", "-af",
                "highpass=f=300,lowpass=f=2500,afade=t=in:d=0.9:curve=exp,afade=t=out:st=0.9:d=0.3,volume=0.10,aformat=channel_layouts=stereo",
                str(swell)], check=True)
cuts = [s["start"] for s in tl["scenes"][1:]]

args = [FF, "-y", "-v", "error", "-i", str(picture), "-i", str(HERE / "build" / "voice.wav"), "-i", str(bed)]
for _ in cuts:
    args += ["-i", str(swell)]
sw = ";".join(f"[{3 + i}:a]adelay={max(0, round((c - 0.9) * 1000))}:all=1[s{i}]" for i, c in enumerate(cuts))
graph = (
    "[1:a]asplit=2[v][vkey];"
    "[2:a][vkey]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[bedd];"
    f"{sw};"
    f"[v][bedd]{''.join(f'[s{i}]' for i in range(len(cuts)))}amix=inputs={2 + len(cuts)}:normalize=0,"
    "loudnorm=I=-15:TP=-1.5:LRA=11[a]"
)
args += ["-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-movflags", "+faststart", "-shortest", str(out)]
subprocess.run(args, check=True)
print("wrote", out)
