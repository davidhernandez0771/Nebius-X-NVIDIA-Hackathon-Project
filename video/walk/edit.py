"""Cut the walkthrough: the screen recordings (build/walk/browser60.mp4, the site; build/walk/isaac2.mp4, Isaac Lab's own
window) laid on the voice (walk/narration.json, spoken by tts.py into build/walk/voice), with subtitles timed to the
words, a chapter label per section, and a quiet bed under the voice. 1920x1080, 60 fps.

    python video/walk/edit.py   -> video/build/walk/sant-walkthrough.mp4

Times below are seconds in browser60.mp4 (its first frame is the recorder's first frame; build/walk/marks.jsonl has
what happened when) or in isaac2.mp4 (its own clock). Each shot is (source, from, to, speed); a line's slot is the length
of its shots, and its voice starts SLOT_LEAD in.
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
B = HERE.parent / "build" / "walk"
FF = "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg"
FPS = 60
SLOT_LEAD = 0.35
BROWSER, ISAAC = "browser", "isaac"
# isaac2.mp4 t=0 is wall clock 1793228630.354; browser60.mp4 t=0 is 1793227605.515
ISAAC_TO_BROWSER = 1793228630.354 - 1793227605.515

CHAPTERS = {"workshop": "01  The workshop", "record": "02  Record", "scene": "03  Scenes from a sentence",
            "pipeline": "04  Run SANT", "data": "05  The data", "results": "06  The results",
            "testtrack": "07  The test track", "close": ""}

# one entry per voice line, in narration.json's order: its shots
SHOTS = {
    "workshop_0": [(BROWSER, 1105.0, 1113.0, 1.0)],
    "workshop_1": [(BROWSER, 1126.0, 1146.0, 2.5)],
    "workshop_2": [(BROWSER, 1212.0, 1219.0, 1.0), (BROWSER, 1231.4, 1235.9, 1.5)],
    "workshop_3": [(BROWSER, 1257.4, 1260.4, 1.2), (BROWSER, 1272.4, 1283.2, 1.8), (BROWSER, 1292.2, 1294.0, 1.0)],
    "record_0": [(BROWSER, 6.0, 10.0, 1.0), (BROWSER, 29.8, 33.8, 1.0)],
    "record_1": [(ISAAC, 6.0, 28.5, 1.5)],
    "record_2": [(BROWSER, 137.0, 147.0, 1.0)],
    "scene_0": [(BROWSER, 150.3, 153.3, 1.0), (BROWSER, 161.2, 166.9, 1.9), (BROWSER, 167.0, 174.5, 1.0)],
    "pipeline_0": [(BROWSER, 326.0, 329.0, 1.0), (BROWSER, 341.0, 359.0, 2.0)],
    "pipeline_1": [(BROWSER, 922.3, 931.3, 1.0)],
    "pipeline_2": [(BROWSER, 899.5, 913.5, 1.0)],
    "data_0": [(BROWSER, 1309.0, 1335.0, 2.0)],
    "results_0": [(BROWSER, 1360.0, 1401.6, 2.6)],
    "testtrack_0": [(BROWSER, 1405.0, 1416.0, 1.0), (BROWSER, 1430.0, 1436.0, 2.0)],
    "close_0": [(BROWSER, 1449.0, 1456.5, 1.5), (BROWSER, 1464.0, 1473.0, 1.0)],
}


def run(args):
    subprocess.run([FF, "-v", "error", "-y", *args], check=True)


def length(p):
    out = subprocess.run([FF.rsplit("/", 1)[0] + "/ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


def cut(i, src, a, b, speed):
    """One shot as its own 60 fps segment (the Isaac shot gets the live page as a picture-in-picture)."""
    out = B / "cuts" / f"{i:02d}.mp4"
    out.parent.mkdir(exist_ok=True)
    pts = f"setpts=(PTS-STARTPTS)/{speed}"
    if src == BROWSER:
        run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(B / "browser60.mp4"), "-vf", f"{pts},fps={FPS},format=yuv420p",
             "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "15", str(out)])
    else:
        pa, pb = a + ISAAC_TO_BROWSER, b + ISAAC_TO_BROWSER
        graph = (f"[0:v]{pts},scale=1920:1080:flags=lanczos,fps={FPS}[bg];"
                 f"[1:v]{pts},scale=600:338:flags=lanczos,fps={FPS},pad=606:344:3:3:color=0x19f5c2[pip];"
                 f"[bg][pip]overlay=W-w-48:H-h-120:shortest=1,format=yuv420p")
        run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(B / "isaac2.mp4"), "-ss", f"{pa:.3f}", "-to", f"{pb:.3f}",
             "-i", str(B / "browser60.mp4"), "-filter_complex", graph, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "15", str(out)])
    return out


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
    cfg = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    words = json.loads((B / "voice" / "words.json").read_text(encoding="utf-8"))
    order = [(s["id"], f"{s['id']}_{n}") for s in cfg["scenes"] for n in range(len(s["lines"]))]

    segs, t, placed, chapters, i = [], 0.0, [], [], 0
    seen = set()
    for scene, key in order:
        slot = sum((b - a) / sp for _, a, b, sp in SHOTS[key])
        voice = B / "voice" / f"{key}.mp3"
        vlen = length(voice)
        assert vlen + SLOT_LEAD + 0.1 <= slot, f"{key}: voice {vlen:.1f} s does not fit its {slot:.1f} s of picture"
        for shot in SHOTS[key]:
            segs.append(cut(i, *shot))
            i += 1
        placed.append((key, t + SLOT_LEAD, vlen))
        if scene not in seen:
            seen.add(scene)
            chapters.append((t, scene))
        t += slot
    total = t
    print(f"picture {total:.1f} s in {len(segs)} shots")

    # the picture: the shots back to back, a fade in and a fade out
    (B / "cuts.txt").write_text("".join(f"file '{p.as_posix()}'\n" for p in segs))
    run(["-f", "concat", "-safe", "0", "-i", str(B / "cuts.txt"), "-vf", f"fade=t=in:st=0:d=0.6,fade=t=out:st={total - 1.2:.2f}:d=1.2",
         "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), str(B / "picture.mp4")])

    # subtitles and chapter labels (ASS, burned in)
    ev = []
    for key, at, _ in placed:
        line = next(l for s in cfg["scenes"] for n, l in enumerate(s["lines"]) if f"{s['id']}_{n}" == key)
        for a, b, text in captions(line, words[key]["words"]):
            ev.append(f"Dialogue: 0,{ass_time(at + a)},{ass_time(at + b + 0.15)},Sub,,0,0,0,,{text}")
    for (ct, scene), nxt in zip(chapters, chapters[1:] + [(total, None)]):
        if CHAPTERS[scene]:
            ev.append(f"Dialogue: 1,{ass_time(ct + 0.2)},{ass_time(min(ct + 4.2, nxt[0]))},Chapter,,0,0,0,,{{\\fad(300,400)}}{CHAPTERS[scene]}")
    end = total - 4.5
    ev.append(f"Dialogue: 1,{ass_time(end)},{ass_time(total - 0.3)},End,,0,0,0,,{{\\fad(500,600)}}SANT  ·  Simulate · Augment · Neaten · Train"
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
    (B / "subs.ass").write_text(ass, encoding="utf-8")

    # the voice on its clock, a quiet drone under it (ducked while the voice speaks), loudness for YouTube
    ins, chains = [], []
    for n, (key, at, _) in enumerate(placed):
        ins += ["-i", str(B / "voice" / f"{key}.mp3")]
        chains.append(f"[{n + 1}:a]adelay={round(at * 1000)}:all=1[v{n}]")
    drone = ("aevalsrc='0.30*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.05*t))+0.22*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.071*t+1))"
             f"+0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.043*t+2))':s=48000:d={total:.3f}")
    nv = len(placed)
    graph = (";".join(chains) + f";{''.join(f'[v{n}]' for n in range(nv))}amix=inputs={nv}:normalize=0,apad=whole_dur={total:.3f},asplit=2[voice][key];"
             f"[{nv + 1}:a]lowpass=f=700,afade=t=in:d=2,afade=t=out:st={total - 3:.2f}:d=3,volume=0.2,aformat=channel_layouts=stereo[bed];"
             "[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[bedd];"
             "[voice][bedd]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[a]")
    subs = (B / "subs.ass").as_posix().replace(":", "\\:")
    run(["-i", str(B / "picture.mp4"), *ins, "-f", "lavfi", "-i", drone, "-filter_complex",
         graph + f";[0:v]subtitles='{subs}'[v]", "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
         "-t", f"{total:.3f}", str(B / "sant-walkthrough.mp4")])
    print("wrote", B / "sant-walkthrough.mp4", f"{total:.1f} s")


if __name__ == "__main__":
    main()
