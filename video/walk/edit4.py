"""Cut walkthrough v4: v3's cut (edit3.py), polished. The boot opens on the loader, not the blank tab; the empty stretch
of the workshop build plays at 3.5x; the workshop line is split so its second half lands when the workshop appears;
small UI (the take review, the scene plan, the pipeline, the test track) is shown as a punch-in crop; the Isaac shot
says its speed; the end card sits on a dimmed workshop with its credits. Voice: walk/narration4.json via tts.py into
build/walk4/voice, with music.py's music under it.

    python video/walk/edit4.py          -> video/build/walk4/sant-walkthrough-v4.mp4      (1080p60)
    python video/walk/edit4.py --4k     -> also video/build/walk4/sant-walkthrough-v4-4k.mp4 (2160p60, for YouTube)

Shots are (source, from, to, speed[, crop]) in that source's seconds; crop is (x, y, width) of a 16:9 region of the
1920x1080 source. If a line's shots are too short for its voice, its speeds are lowered until it fits. The story
segments keep their own speeds.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

from music import compose

HERE = Path(__file__).parent
BUILD = HERE.parent / "build"
B2 = BUILD / "walk4"
FFDIR = "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin"
FF, FP = f"{FFDIR}/ffmpeg", f"{FFDIR}/ffprobe"
FPS = 60
X = 0.3  # cross-fade length
LEAD = 0.3  # a line's voice starts this long into its first shot
GAP = 0.25  # at least this much quiet before the next line
END = 4.6  # the end card's length, on the last shot, after the voice
SRC = {"story": BUILD / "walk3" / "take" / "story60.mp4", "tour": BUILD / "walk2" / "take" / "tour60.mp4",
       "browser": BUILD / "walk" / "browser60.mp4", "isaac": BUILD / "walk" / "isaac2.mp4"}
# isaac2.mp4 t=0 is wall clock 1793228630.354; browser60.mp4 t=0 is 1793227605.515
ISAAC_TO_BROWSER = 1793228630.354 - 1793227605.515

CHAPTERS = {"boot": "", "story": "01  The story", "workshop": "02  The workshop", "record": "03  Record, in Isaac Lab",
            "scene": "04  Scenes from a sentence", "pipeline": "05  Run SANT", "testtrack": "06  The test track",
            "future": "07  What's next"}
# caption lines never break inside these
NAMES = ["NVIDIA Isaac Lab", "Nebius Token Factory", "Physical AI Workbench", "Franka arm"]

# the boot (loader and hero), then the story's scroll; 90-97 s is the empty start of the workshop build, played at 3.5x
BOOT = ("story", 3.0, 9.0, 1.0)
PAN = [("story", 19.6, 90.0, 1.0), ("story", 90.0, 97.0, 3.5), ("story", 97.0, 105.2, 1.0)]
STORY_AT = {"boot_0": None, "story_0": 27.8, "story_1": 40.6, "story_2": 53.3, "story_3": 58.9, "story_4": 65.6,
            "story_5": 71.8, "story_6": 77.6, "story_7": 82.4, "workshop_0": 89.4, "workshop_1": 102.0}

REVIEW = (0, 477, 1072)  # the take review, bottom left
PLAN = (860, 0, 1060)  # the scenes panel and Nemotron's plan, top right
STAGES = (0, 60, 1600)  # the pipeline's stages and verified copies
TRACK = (200, 60, 1520)  # the test track's replay and its numbers
FAILS = (200, 520, 960)  # the test track's run grid and why runs failed
SHOTS = {
    "workshop_2": [("tour", 306.5, 316.0, 1.3)],
    "workshop_3": [("tour", 328.0, 338.0, 1.6)],
    "workshop_4": [("tour", 384.5, 386.5, 1.0), ("tour", 389.0, 392.5, 1.0), ("tour", 419.5, 422.0, 1.0)],
    "workshop_5": [("tour", 459.0, 462.0, 1.0), ("tour", 478.5, 481.5, 1.0)],
    "workshop_6": [("tour", 505.0, 507.5, 1.0), ("tour", 523.0, 525.5, 1.0)],
    "record_0": [("isaac", 6.0, 28.5, 2.3)],
    "record_1": [("browser", 137.0, 139.5, 1.0), ("browser", 139.5, 144.6, 1.0, REVIEW)],
    "scene_0": [("browser", 161.2, 166.9, 2.5, PLAN), ("browser", 168.5, 173.2, 1.0, PLAN)],
    "pipeline_0": [("browser", 922.3, 925.3, 1.0), ("browser", 899.5, 908.5, 1.0, STAGES)],
    "testtrack_0": [("browser", 1406.5, 1412.5, 1.0, TRACK), ("browser", 1412.5, 1416.0, 1.0, FAILS)],
    "future_0": [("tour", 389.0, 397.0, 1.5), ("tour", 478.0, 483.0, 1.3), ("tour", 544.0, 553.3, 1.0)],
}


def run(args):
    subprocess.run([FF, "-v", "error", "-y", *args], check=True)


def length(p):
    out = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True)
    return float(out.stdout)


def cut(i, src, a, b, speed, crop=None):
    """One shot as its own 60 fps segment (the Isaac shot gets the live page as a picture-in-picture)."""
    out = B2 / "cuts" / f"{i:02d}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    pts = f"setpts=(PTS-STARTPTS)/{speed:.4f}"
    enc = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", "-r", str(FPS)]
    if src != "isaac":
        zoom = f"crop={crop[2]}:{round(crop[2] * 9 / 16)}:{crop[0]}:{crop[1]}," if crop else ""
        run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(SRC[src]), "-vf", f"{pts},fps={FPS},{zoom}scale=1920:1080:flags=lanczos", *enc, str(out)])
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


def tokenize(text):
    """The line's words, with each of NAMES kept as one token."""
    tokens, words = [], text.split()
    i = 0
    while i < len(words):
        for name in NAMES:
            n = len(name.split())
            if norm(" ".join(words[i:i + n])).startswith(norm(name)):
                tokens.append(" ".join(words[i:i + n]))
                i += n
                break
        else:
            tokens.append(words[i])
            i += 1
    return tokens


def captions(text, words, max_len=36):
    """The line cut into captions (punctuation kept), each timed by its spoken words (offsets in the line)."""
    tokens = tokenize(text)
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
    out[-1][1] += 0.15  # the last caption lingers a moment; the others hand over exactly
    return out


def ass_time(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def main():
    cfg = json.loads((HERE / "narration4.json").read_text(encoding="utf-8"))
    words = json.loads((B2 / "voice" / "words.json").read_text(encoding="utf-8"))
    order = [(s["id"], f"{s['id']}_{n}", line) for s in cfg["scenes"] for n, line in enumerate(s["lines"])]
    lines = {key: (scene, line) for scene, key, line in order}

    # clips: (path, length, source, speed); every clip starts X before the previous one ends
    clips, placed, chapters, seen, i = [], [], [], set(), 0
    t = 0.0
    starts = []
    for shot in (BOOT, *PAN):
        path, dur = cut(i, *shot)
        starts.append(t)
        clips.append((path, dur, shot[0], shot[3]))
        t += dur - X
        i += 1

    def story_to_film(s):
        for n, (src, a, b, sp) in enumerate(PAN):
            if a <= s < b or n == len(PAN) - 1:
                return starts[n + 1] + (s - a) / sp
    free = 0.0  # when the previous line has finished
    for key, at in STORY_AT.items():
        scene, line = lines[key]
        g = 0.4 if at is None else story_to_film(at)
        if g < free:  # its title is up, but the line before is still speaking: wait for it
            if free - g > 1.5:
                print(f"warning: {key} waits {free - g:.2f} s after its title")
            g = free
        placed.append((key, line, g))
        free = g + length(B2 / "voice" / f"{key}.mp3") + GAP
        if scene not in seen:
            seen.add(scene)
            chapters.append((max(0.0, g - LEAD), scene))
    if free > t:
        print(f"warning: the story's last line runs {free - t:.2f} s past the story")

    # the rest: each line on its own shots, slowed if it must be to hold its voice
    speeds = []  # (film from, film to, speed) of the Isaac shots
    for scene, key, line in order:
        if key in STORY_AT:
            continue
        shots = SHOTS[key]
        voice = length(B2 / "voice" / f"{key}.mp3")
        need = LEAD + voice + GAP + X + (END - 0.6 if key == "future_0" else 0)
        have = sum((s[2] - s[1]) / s[3] for s in shots) - X * (len(shots) - 1)
        slow = max(1.0, need / have)
        if slow > 1.0:
            print(f"{key}: slowed x{slow:.2f} to fit its voice ({voice:.1f} s)")
        start = t
        for src, a, b, sp, *crop in shots:
            path, dur = cut(i, src, a, b, sp / slow, *crop)
            clips.append((path, dur, src, sp / slow))
            if src == "isaac":
                speeds.append((t, t + dur, sp / slow))
            t += dur - X
            i += 1
        placed.append((key, line, start + LEAD))
        if scene not in seen:
            seen.add(scene)
            chapters.append((start, scene))
    total = t + X
    print(f"picture {total:.1f} s in {len(clips)} shots")

    # the picture: every shot cross-fades into the next; the end card's shot dims under it
    ins, graph, prev, off = [], [], "[0:v]", 0.0
    for p, *_ in clips:
        ins += ["-i", str(p)]
    for n in range(1, len(clips)):
        off += clips[n - 1][1] - X
        lab = f"[x{n}]"
        graph.append(f"{prev}[{n}:v]xfade=transition=fade:duration={X}:offset={off:.4f}{lab}")
        prev = lab
    graph.append(f"color=c=black:s=1920x1080:r={FPS}:d={total:.3f},format=rgba,colorchannelmixer=aa=0.74,"
                 f"fade=t=in:st={total - END:.3f}:d=0.8:alpha=1[dim]")
    graph.append(f"{prev}[dim]overlay=shortest=1,fade=t=in:st=0:d=0.5,fade=t=out:st={total - 1.2:.3f}:d=1.2,format=yuv420p[v]")
    run([*ins, "-filter_complex", ";".join(graph), "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-r", str(FPS),
         str(B2 / "picture.mp4")])

    # subtitles, chapter labels, the Isaac shot's speed, the end card (ASS, burned in)
    ev = []
    for key, line, at in placed:
        for a, b, text in captions(line, words[key]["words"]):
            ev.append(f"Dialogue: 0,{ass_time(at + a)},{ass_time(at + b)},Sub,,0,0,0,,{text}")
    for (ct, scene), nxt in zip(chapters, chapters[1:] + [(total, None)]):
        if CHAPTERS[scene]:
            ev.append(f"Dialogue: 1,{ass_time(ct + 0.3)},{ass_time(min(ct + 4.3, nxt[0]))},Chapter,,0,0,0,,{{\\fad(300,400)}}{CHAPTERS[scene]}")
    for a, b, sp in speeds:
        ev.append(f"Dialogue: 1,{ass_time(a + 0.5)},{ass_time(b - 0.5)},Tag,,0,0,0,,{{\\fad(300,300)}}{sp:.1f}× speed")
    ev.append(f"Dialogue: 1,{ass_time(total - END + 0.5)},{ass_time(total - 0.3)},End,,0,0,0,,{{\\fad(500,600)}}SANT"
              "\\N{\\fs34}Simulate · Augment · Neaten · Train"
              "\\N{\\fs8} \\N{\\fs26\\c&HC2F519&}github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project"
              "\\N{\\fs8} \\N{\\fs22\\c&HB4B8B0&}NVIDIA Isaac Lab  ·  NVIDIA Nemotron on Nebius Token Factory")
    ass = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Sub,Segoe UI Semibold,58,&H00F7F8F4,&H00FFFFFF,&H00050402,&H38050402,0,0,0,0,100,100,0,0,3,16,0,2,80,80,58,1\n"
        "Style: Chapter,Consolas,36,&H00C2F519,&H00FFFFFF,&H10050402,&H10050402,1,0,0,0,100,100,2,0,3,12,0,7,60,60,110,1\n"
        "Style: Tag,Consolas,30,&H00F7F8F4,&H00FFFFFF,&H10050402,&H10050402,0,0,0,0,100,100,1,0,3,10,0,9,60,60,60,1\n"
        "Style: End,Segoe UI Semibold,64,&H00F7F8F4,&H00FFFFFF,&H00050402,&H00050402,0,0,0,0,100,100,2,0,1,0,0,5,80,80,80,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(ev) + "\n"
    )
    (B2 / "subs.ass").write_text(ass, encoding="utf-8")

    # the music (music.py, composed to the sections; v4's drone read as a hum and is gone)
    starts = {scene: ct for ct, scene in chapters}
    compose(total, {k: starts[k] for k in ("story", "workshop", "record", "future")}, B2 / "music.wav")

    # the voice on its clock: resampled cleanly to 48 kHz, rumble cut, a little warmth, the harsh band eased, gently
    # compressed; the music under it, dipping while the voice speaks; peaks held so the loudness pass reaches its target
    ains, chains = [], []
    for n, (key, _, at) in enumerate(placed):
        ains += ["-i", str(B2 / "voice" / f"{key}.mp3")]
        chains.append(f"[{n + 1}:a]aresample=48000:resampler=soxr,adelay={round(at * 1000)}:all=1[v{n}]")
    nv = len(placed)
    agraph = (";".join(chains) + f";{''.join(f'[v{n}]' for n in range(nv))}amix=inputs={nv}:normalize=0,apad=whole_dur={total:.3f},"
              "aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,equalizer=f=180:t=q:w=1.2:g=1.5,"
              "equalizer=f=3400:t=q:w=1.4:g=-1.5,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=2dB,"
              "asplit=2[voice][key];"
              f"[{nv + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.22[bed];"
              "[bed][key]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=700[bedd];"
              "[voice][bedd]amix=inputs=2:normalize=0,alimiter=limit=0.7:attack=3:release=60:level=false[a]")
    run(["-i", str(B2 / "picture.mp4"), *ains, "-i", str(B2 / "music.wav"), "-filter_complex", agraph, "-map", "[a]",
         "-c:a", "pcm_f32le", "-ar", "48000", "-t", f"{total:.3f}", str(B2 / "mix.wav")])
    # loudness in two passes (measure, then apply as one gain), so it lands on YouTube's -14 LUFS
    target = "I=-14:TP=-1.5:LRA=11"
    probe = subprocess.run([FF, "-hide_banner", "-i", str(B2 / "mix.wav"), "-af", f"loudnorm={target}:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, check=True).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    run(["-i", str(B2 / "mix.wav"), "-af", f"loudnorm={target}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
         f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true", "-c:a", "pcm_s16le", "-ar", "48000", str(B2 / "audio.wav")])

    # the picture with its subtitles, at 1080p, and (--4k) at 2160p with the text drawn at that size
    subs = (B2 / "subs.ass").as_posix().replace(":", "\\:")
    outs = [("sant-walkthrough-v4.mp4", "", ["-crf", "16", "-maxrate", "40M", "-bufsize", "80M"])]
    if "--4k" in sys.argv:
        outs.append(("sant-walkthrough-v4-4k.mp4", "scale=3840:2160:flags=lanczos,", ["-crf", "14", "-maxrate", "90M", "-bufsize", "180M"]))
    for name, up, rate in outs:
        run(["-i", str(B2 / "picture.mp4"), "-i", str(B2 / "audio.wav"), "-vf", f"{up}subtitles='{subs}'", "-map", "0:v", "-map", "1:a",
             "-c:v", "libx264", "-preset", "slow", *rate, "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(FPS // 2), "-bf", "2",
             "-c:a", "aac", "-b:a", "384k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.3f}", str(B2 / name)])
        print("wrote", B2 / name, f"{total:.1f} s")


if __name__ == "__main__":
    main()
