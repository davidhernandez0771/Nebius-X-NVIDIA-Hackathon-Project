"""Cut walkthrough v3: the boot and the story as one constant, slow scroll at 1x (build/walk3/take/story60.mp4, a
300 px/s pan), each story line placed when its title is on screen; then the workshop's five stations (build/walk2/take/
tour60.mp4) and the live part (build/walk/browser60.mp4, isaac2.mp4), each line on its own shots. Voice:
walk/narration3.json via tts.py into build/walk3/voice. Shots cross-fade; subtitles are timed to the words; a chapter
label per section; a quiet bed under the voice. 1920x1080, 60 fps.

    python video/walk/edit3.py   -> video/build/walk3/sant-walkthrough-v3.mp4

Shots are (source, from, to, speed) in that source's seconds. If a line's shots are too short for its voice, its speeds
are lowered until it fits. The story is never sped up.
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
BUILD = HERE.parent / "build"
B2 = BUILD / "walk3"
FFDIR = "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin"
FF, FP = f"{FFDIR}/ffmpeg", f"{FFDIR}/ffprobe"
FPS = 60
X = 0.3  # cross-fade length
LEAD = 0.3  # a line's voice starts this long into its first shot
GAP = 0.25  # at least this much quiet before the next line
SRC = {"story": B2 / "take" / "story60.mp4", "tour": BUILD / "walk2" / "take" / "tour60.mp4", "browser": BUILD / "walk" / "browser60.mp4", "isaac": BUILD / "walk" / "isaac2.mp4"}
# isaac2.mp4 t=0 is wall clock 1793228630.354; browser60.mp4 t=0 is 1793227605.515
ISAAC_TO_BROWSER = 1793228630.354 - 1793227605.515

CHAPTERS = {"boot": "", "story": "01  The story", "workshop": "02  The workshop", "record": "03  Record, live in Isaac Lab",
            "scene": "04  Scenes from a sentence", "pipeline": "05  Run SANT", "testtrack": "06  The test track",
            "future": "07  What's next"}

# the story: the loader and hero, then the pan from where it starts; each line starts at its title (story60.mp4 seconds)
BOOT = ("story", 1.0, 7.5, 1.0)
PAN = ("story", 19.6, 104.0, 1.0)
STORY_AT = {"boot_0": None, "story_0": 27.8, "story_1": 40.6, "story_2": 53.3, "story_3": 58.9, "story_4": 65.6,
            "story_5": 71.8, "story_6": 77.6, "workshop_0": 90.5}

SHOTS = {
    "workshop_1": [("tour", 306.5, 316.0, 1.3)],
    "workshop_2": [("tour", 328.0, 338.0, 1.4)],
    "workshop_3": [("tour", 384.5, 386.5, 1.0), ("tour", 389.0, 392.5, 1.0), ("tour", 419.5, 422.5, 1.0)],
    "workshop_4": [("tour", 459.0, 462.0, 1.0), ("tour", 478.5, 481.5, 1.0)],
    "workshop_5": [("tour", 505.0, 507.5, 1.0), ("tour", 523.0, 526.0, 1.0)],
    "record_0": [("isaac", 6.0, 28.5, 2.3)],
    "record_1": [("browser", 137.0, 144.5, 1.0)],
    "scene_0": [("browser", 161.2, 166.9, 2.5), ("browser", 167.0, 171.5, 1.0)],
    "pipeline_0": [("browser", 922.3, 925.3, 1.0), ("browser", 899.5, 908.5, 1.0)],
    "testtrack_0": [("browser", 1405.0, 1411.0, 1.0)],
    "future_0": [("tour", 389.0, 397.0, 1.5), ("tour", 478.0, 483.0, 1.3), ("tour", 542.0, 547.0, 1.0)],
}


def run(args):
    subprocess.run([FF, "-v", "error", "-y", *args], check=True)


def length(p):
    out = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True)
    return float(out.stdout)


def cut(i, src, a, b, speed):
    """One shot as its own 60 fps segment (the Isaac shot gets the live page as a picture-in-picture)."""
    out = B2 / "cuts" / f"{i:02d}.mp4"
    out.parent.mkdir(exist_ok=True)
    pts = f"setpts=(PTS-STARTPTS)/{speed:.4f}"
    enc = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS)]
    if src != "isaac":
        run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(SRC[src]), "-vf", f"{pts},fps={FPS},scale=1920:1080:flags=lanczos", *enc, str(out)])
    else:
        pa, pb = a + ISAAC_TO_BROWSER, b + ISAAC_TO_BROWSER
        graph = (f"[0:v]{pts},scale=1920:1080:flags=lanczos,fps={FPS}[bg];"
                 f"[1:v]{pts},scale=600:338:flags=lanczos,fps={FPS},pad=606:344:3:3:color=0x19f5c2[pip];"
                 f"[bg][pip]overlay=W-w-48:H-h-120:shortest=1")
        run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(SRC["isaac"]), "-ss", f"{pa:.3f}", "-to", f"{pb:.3f}",
             "-i", str(SRC["browser"]), "-filter_complex", graph, *enc, str(out)])
    return out, length(out)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def captions(text, words, max_len=44):
    """The line cut into captions (punctuation kept), each timed by its spoken words (offsets in the line)."""
    tokens = text.split()
    starts, ends, k = [], [], 0
    for tok in tokens:
        want = norm(tok)
        w = words[min(k, len(words) - 1)]
        starts.append(w["t"])
        got, last = "", w
        while k < len(words) and len(got) < len(want):
            last = words[k]
            got += norm(words[k]["w"])
            k += 1
            if not want.startswith(got):
                break
        ends.append(last["t"] + last["d"])
    out, cur = [], []

    def flush():
        if cur:
            out.append([starts[cur[0]], ends[cur[-1]], " ".join(tokens[j] for j in cur)])
            cur.clear()

    for i, tok in enumerate(tokens):
        if cur and len(" ".join(tokens[j] for j in cur + [i])) > max_len:
            flush()
        cur.append(i)
        joined = " ".join(tokens[j] for j in cur)
        if re.search(r"[.!?]$", tok) or (re.search(r"[,:;]$", tok) and len(joined) > max_len * 0.45):
            flush()
    flush()
    for a, b in zip(out, out[1:]):
        a[1] = b[0]
    return out


def ass_time(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def main():
    cfg = json.loads((HERE / "narration3.json").read_text(encoding="utf-8"))
    words = json.loads((B2 / "voice" / "words.json").read_text(encoding="utf-8"))
    order = [(s["id"], f"{s['id']}_{n}", line) for s in cfg["scenes"] for n, line in enumerate(s["lines"])]

    lines = {key: (scene, line) for scene, key, line in order}

    clips, placed, chapters, seen, i = [], [], [], set(), 0
    # the boot and the story: two clips, never sped up; the lines go where their titles are
    for shot in (BOOT, PAN):
        clips.append(cut(i, *shot))
        i += 1
    pan_start = clips[0][1] - X  # where the pan clip begins in the film
    for key, at in STORY_AT.items():
        scene, line = lines[key]
        g = 0.4 if at is None else pan_start + (at - PAN[1])
        placed.append((key, line, g))
        if scene not in seen:
            seen.add(scene)
            chapters.append((max(0.0, g - LEAD), scene))
    for (k1, _, g1), (k2, _, g2) in zip(placed, placed[1:]):
        end = g1 + length(B2 / "voice" / f"{k1}.mp3")
        if end + 0.1 > g2:
            print(f"warning: {k1} runs {end - g2 + 0.1:.2f} s into {k2}")
    t = pan_start + clips[1][1] - X

    # the rest: each line on its own shots, slowed if it must be to hold its voice
    for scene, key, line in order:
        if key in STORY_AT:
            continue
        shots = SHOTS[key]
        voice = length(B2 / "voice" / f"{key}.mp3")
        need = LEAD + voice + GAP + X
        have = sum((b - a) / sp for _, a, b, sp in shots) - X * (len(shots) - 1)
        slow = max(1.0, need / have)
        if slow > 1.0:
            print(f"{key}: slowed x{slow:.2f} to fit its voice ({voice:.1f} s)")
        start = t
        for src, a, b, sp in shots:
            path, dur = cut(i, src, a, b, sp / slow)
            clips.append((path, dur))
            t += dur - X
            i += 1
        placed.append((key, line, start + LEAD))
        if scene not in seen:
            seen.add(scene)
            chapters.append((start, scene))
    total = t + X
    print(f"picture {total:.1f} s in {len(clips)} shots")

    # the picture: every shot cross-fades into the next
    ins, graph, prev, off = [], [], "[0:v]", 0.0
    for n, (p, d) in enumerate(clips):
        ins += ["-i", str(p)]
    for n in range(1, len(clips)):
        off += clips[n - 1][1] - X
        lab = f"[x{n}]"
        graph.append(f"{prev}[{n}:v]xfade=transition=fade:duration={X}:offset={off:.4f}{lab}")
        prev = lab
    graph.append(f"{prev}fade=t=in:st=0:d=0.5,fade=t=out:st={total - 1.2:.3f}:d=1.2,format=yuv420p[v]")
    run([*ins, "-filter_complex", ";".join(graph), "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-r", str(FPS),
         str(B2 / "picture.mp4")])

    # subtitles, chapter labels, the end card (ASS, burned in)
    ev = []
    for key, line, at in placed:
        for a, b, text in captions(line, words[key]["words"]):
            ev.append(f"Dialogue: 0,{ass_time(at + a)},{ass_time(at + b + 0.15)},Sub,,0,0,0,,{text}")
    for (ct, scene), nxt in zip(chapters, chapters[1:] + [(total, None)]):
        if CHAPTERS[scene]:
            ev.append(f"Dialogue: 1,{ass_time(ct + 0.3)},{ass_time(min(ct + 4.3, nxt[0]))},Chapter,,0,0,0,,{{\\fad(300,400)}}{CHAPTERS[scene]}")
    ev.append(f"Dialogue: 1,{ass_time(total - 4.6)},{ass_time(total - 0.3)},End,,0,0,0,,{{\\fad(500,600)}}SANT  ·  Simulate · Augment · Neaten · Train"
              "\\N{\\fs26\\c&HC2F519&}github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project")
    ass = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Sub,Segoe UI Semibold,44,&H00F7F8F4,&H00FFFFFF,&H00050402,&H38050402,0,0,0,0,100,100,0,0,3,14,0,2,80,80,58,1\n"
        "Style: Chapter,Consolas,30,&H00C2F519,&H00FFFFFF,&H00050402,&H60050402,1,0,0,0,100,100,2,0,3,12,0,7,60,60,110,1\n"
        "Style: End,Segoe UI Semibold,40,&H00F7F8F4,&H00FFFFFF,&H00050402,&H60050402,0,0,0,0,100,100,1,0,3,18,0,5,80,80,80,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(ev) + "\n"
    )
    (B2 / "subs.ass").write_text(ass, encoding="utf-8")

    # the voice on its clock, a quiet drone under it (ducked while the voice speaks), loudness for YouTube
    ains, chains = [], []
    for n, (key, _, at) in enumerate(placed):
        ains += ["-i", str(B2 / "voice" / f"{key}.mp3")]
        chains.append(f"[{n + 1}:a]adelay={round(at * 1000)}:all=1[v{n}]")
    drone = ("aevalsrc='0.30*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.05*t))+0.22*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.071*t+1))"
             f"+0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.043*t+2))':s=48000:d={total:.3f}")
    nv = len(placed)
    agraph = (";".join(chains) + f";{''.join(f'[v{n}]' for n in range(nv))}amix=inputs={nv}:normalize=0,apad=whole_dur={total:.3f},asplit=2[voice][key];"
              f"[{nv + 1}:a]lowpass=f=700,afade=t=in:d=2,afade=t=out:st={total - 3:.2f}:d=3,volume=0.2,aformat=channel_layouts=stereo[bed];"
              "[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[bedd];"
              "[voice][bedd]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[a]")
    subs = (B2 / "subs.ass").as_posix().replace(":", "\\:")
    run(["-i", str(B2 / "picture.mp4"), *ains, "-f", "lavfi", "-i", drone, "-filter_complex", agraph + f";[0:v]subtitles='{subs}'[v]",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.3f}", str(B2 / "sant-walkthrough-v3.mp4")])
    print("wrote", B2 / "sant-walkthrough-v3.mp4", f"{total:.1f} s")


if __name__ == "__main__":
    main()
