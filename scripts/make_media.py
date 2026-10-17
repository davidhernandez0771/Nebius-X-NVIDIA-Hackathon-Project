"""Submission media from recorded episodes: a GIF with a timeline bar, a side-by-side GIF, a contact sheet.

    uv run python scripts/make_media.py --episode <ep_dir> [--diagnosis diagnosis.json | --rules] \\
        [--compare <other ep_dir>] [--labels raw,perfected] [--camera front] [--gif-fps 10] --out <dir>

An episode dir is the episode_io format: episode.json, steps.npz, <camera>/000000.png ... (the sim worker's).
Writes, in --out:
- <demo_id>.gif: the episode in real time. Under every frame is a timeline: segments as bands, issues as
  marks (ranges, or ticks for point issues), and a cursor at the frame's time.
- <demo_id>_sheet.png: 6 evenly spaced frames, each captioned with its time and active segment/issues.
- <a>_vs_<b>.gif (with --compare): both episodes on one shared time scale. The shorter one holds its last
  frame.

--diagnosis takes a Diagnosis JSON or a stored one (the demo store's diagnosis.json). --rules diagnoses the
recorded steps with the rules detector (free, local). Without either, the timeline has only the cursor.
The frame-selection and timeline math lives in demo_pipeline.media; this script only draws (Pillow).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from demo_pipeline import media  # noqa: E402
from demo_pipeline.episode_io import load_episode  # noqa: E402
from demo_pipeline.measure import compute_windows  # noqa: E402
from demo_pipeline.rules import detect_rules  # noqa: E402
from demo_pipeline.schemas import Diagnosis, SimSignals, Trajectory  # noqa: E402

SCALE = 2  # GIF frames: the sim's 128 px images shown at 256 px (x3 doubles the file size; see --scale)
SHEET_SCALE = 2
TIMELINE_H = 34
SEGMENT_Y, SEGMENT_H = 6, 9  # bands, from the top of the timeline strip
ISSUE_Y, ISSUE_H = 18, 10
LABEL_H = 24  # the title / label strip above side-by-side panels and the sheet
CAPTION_H = 22
GAP = 8
CURSOR = (17, 24, 39)
STRIP_BG = (249, 250, 251)
BG = (255, 255, 255)
COLORS = 64  # one palette shared by every GIF frame: ~4x smaller files than per-frame 256-colour palettes
SATURATED = 60  # max - min channel spread above which a scene pixel counts as saturated (cube, bin, arm decals)
N_SATURATED = 8  # palette entries reserved for those few pixels, so the cube and bin keep their colours


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font
        return ImageFont.load_default()


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def _frames(ep_dir: Path, camera: str) -> tuple[str, int, float, list[Path]]:
    """(demo id, n_steps, fps, the camera's frame paths); ValueError if that camera was not recorded."""
    meta, _, images = load_episode(ep_dir)
    paths = images.get(camera, [])
    if camera not in meta.cameras or not paths or not paths[0].is_file():
        raise ValueError(f"{ep_dir} has no {camera!r} frames (cameras: {meta.cameras or 'none'}); "
                         f"replay it with cameras to make media")
    return meta.demo_id, meta.n_steps, float(meta.fps), paths


def _open(path: Path, scale: int) -> Image.Image:
    with Image.open(path) as im:
        im = im.convert("RGB")
        return im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)


def compose_frame(frame: Image.Image, layout: media.Layout, t: float, labels: list[str] = (),
                  scale: int = SCALE) -> Image.Image:
    """The frame (scaled) with a timeline strip below it, and the active labels over its top-left corner."""
    if frame.width != layout.bar.width:
        frame = frame.resize((frame.width * scale, frame.height * scale), Image.Resampling.NEAREST)
    out = Image.new("RGB", (frame.width, frame.height + TIMELINE_H), STRIP_BG)
    out.paste(frame, (0, 0))
    d = ImageDraw.Draw(out)
    top = frame.height
    bar = layout.bar
    d.rectangle([bar.pad, top + SEGMENT_Y, bar.width - bar.pad - 1, top + SEGMENT_Y + SEGMENT_H - 1], fill=(229, 231, 235))
    for m in layout.segments:
        d.rectangle([m.x0, top + SEGMENT_Y, max(m.x1 - 1, m.x0), top + SEGMENT_Y + SEGMENT_H - 1], fill=_rgb(m.color))
    for m in layout.issues:
        if m.point:
            d.rectangle([m.x0 - 1, top + SEGMENT_Y - 2, m.x0 + 1, top + ISSUE_Y + ISSUE_H + 2], fill=_rgb(m.color))
        else:
            d.rectangle([m.x0, top + ISSUE_Y, max(m.x1 - 1, m.x0), top + ISSUE_Y + ISSUE_H - 1], fill=_rgb(m.color))
    x = bar.x(t)
    d.rectangle([x - 1, top, x, top + TIMELINE_H - 1], fill=CURSOR)
    text = f"{t:4.1f} s" + (f"  {' · '.join(labels)}" if labels else "")
    font = _font(13)
    box = d.textbbox((6, 4), text, font=font)
    d.rectangle([box[0] - 4, box[1] - 3, box[2] + 4, box[3] + 3], fill=(17, 24, 39))
    d.text((6, 4), text, fill=(255, 255, 255), font=font)
    return out


def _median_cut(px: np.ndarray, n: int) -> list[tuple[int, int, int]]:
    """Up to n representative colours of an [M, 3] pixel array."""
    w = 256
    px = np.resize(px, (max(len(px) // w, 1) * w, 3)).astype(np.uint8)
    q = Image.fromarray(px.reshape(-1, w, 3)).quantize(colors=n, method=Image.Quantize.MEDIANCUT,
                                                       dither=Image.Dither.NONE)
    pal = q.getpalette()[: 3 * n]
    return [tuple(pal[3 * i:3 * i + 3]) for i in np.unique(np.asarray(q))]


def shared_palette(frames: list[Image.Image], colors: int) -> Image.Image:
    """One palette for the whole GIF. Exact entries come first: the timeline and label colours, then up to
    N_SATURATED colours of the scene's few saturated pixels: a palette fitted to pixel counts alone spends its
    entries on the floor's greys and washes the bin out (s1_0002: (111, 167, 218) for an (80, 157, 232) bin).
    The rest is a median cut of evenly sampled frames."""
    reserved = [_rgb(c) for c in (*media.SEGMENT_COLORS.values(), *media.ISSUE_COLORS.values(), media.DEFAULT_COLOR)]
    reserved += [CURSOR, STRIP_BG, BG, (229, 231, 235), (255, 255, 255)]
    picks = np.linspace(0, len(frames) - 1, min(8, len(frames))).astype(int)
    px = np.concatenate([np.asarray(frames[i].convert("RGB")).reshape(-1, 3) for i in picks]).astype(int)
    entries = list(dict.fromkeys(reserved))
    sat = px[(px.max(axis=1) - px.min(axis=1)) > SATURATED]
    if len(sat):
        entries += [c for c in _median_cut(sat, N_SATURATED) if c not in entries]
    if len(entries) < colors:
        entries += [c for c in _median_cut(px, colors - len(entries)) if c not in entries]
    entries = entries[:colors]
    flat = [v for c in entries for v in c]
    pal = Image.new("P", (1, 1))
    pal.putpalette(flat + flat[-3:] * (256 - len(entries)))
    return pal


def _save_gif(frames: list[Image.Image], delays: list[int], out: Path, colors: int = COLORS) -> Path:
    """colors > 0: every frame mapped (no dithering) onto one shared palette of that many colours; 0: Pillow's
    own adaptive 256-colour palette per frame (about 4x larger files)."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if colors:
        pal = shared_palette(frames, colors)
        frames = [f.convert("RGB").quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=delays, loop=0, optimize=True)
    return out


def render_gif(ep_dir: Path, out: Path, diagnosis: Diagnosis | None = None, *, camera: str = "front",
               gif_fps: float = 10.0, max_frames: int | None = 300, scale: int = SCALE,
               colors: int = COLORS) -> Path:
    _, n, fps, paths = _frames(ep_dir, camera)
    steps, delays = media.gif_frames(n, fps, gif_fps, max_frames)
    first = _open(paths[0], scale)
    layout = media.timeline_layout(diagnosis, duration=n / fps, width=first.width)
    frames = []
    for s in steps:
        t = media.step_time(s, fps)
        frames.append(compose_frame(_open(paths[s], scale), layout, t, media.active_labels(diagnosis, t), scale))
    return _save_gif(frames, delays, out, colors)


def render_side_by_side(ep_a: Path, ep_b: Path, out: Path, *, labels: tuple[str, str] = ("raw", "perfected"),
                        diagnoses: tuple[Diagnosis | None, Diagnosis | None] = (None, None), camera: str = "front",
                        gif_fps: float = 10.0, max_frames: int | None = 300, scale: int = SCALE,
                        colors: int = COLORS) -> Path:
    _, n_a, fps_a, pa = _frames(ep_a, camera)
    _, n_b, fps_b, pb = _frames(ep_b, camera)
    if fps_a != fps_b:
        raise ValueError(f"the episodes run at {fps_a} and {fps_b} fps; side by side needs one rate")
    pairs, delays = media.pair_frames(n_a, n_b, fps_a, gif_fps, max_frames)
    w = _open(pa[0], scale).width
    lays = media.side_by_side_layouts(diagnoses, n_a, n_b, fps_a, w)
    font = _font(15)
    frames = []
    for (ia, ib), s in zip(pairs, media.gif_frames(max(n_a, n_b), fps_a, gif_fps, max_frames)[0]):
        t = media.step_time(s, fps_a)
        panels = []
        for paths, i, n, lay, diag in ((pa, ia, n_a, lays[0], diagnoses[0]), (pb, ib, n_b, lays[1], diagnoses[1])):
            shown, done = media.panel_time(t, n, fps_a)
            active = ["done"] if done else media.active_labels(diag, shown)
            panels.append(compose_frame(_open(paths[i], scale), lay, shown, active, scale))
        img = Image.new("RGB", (2 * w + GAP, LABEL_H + panels[0].height), BG)
        d = ImageDraw.Draw(img)
        for k, (panel, label) in enumerate(zip(panels, labels)):
            x = k * (w + GAP)
            img.paste(panel, (x, LABEL_H))
            d.text((x + 4, 4), label, fill=(17, 24, 39), font=font)
        frames.append(img)
    return _save_gif(frames, delays, out, colors)


def render_contact_sheet(ep_dir: Path, out: Path, diagnosis: Diagnosis | None = None, *, camera: str = "front",
                         k: int = 6, cols: int = 3) -> Path:
    demo_id, n, fps, paths = _frames(ep_dir, camera)
    steps = media.select_frames(n, k)
    tile = _open(paths[0], SHEET_SCALE).width
    rows = -(-len(steps) // cols)
    sheet = Image.new("RGB", (cols * tile + (cols + 1) * GAP, LABEL_H + rows * (tile + CAPTION_H) + (rows + 1) * GAP), BG)
    d = ImageDraw.Draw(sheet)
    d.text((GAP, 5), f"{demo_id}  ({n / fps:.1f} s, {camera} camera)", fill=(17, 24, 39), font=_font(14))
    font = _font(12)
    for i, s in enumerate(steps):
        r, c = divmod(i, cols)
        x, y = GAP + c * (tile + GAP), LABEL_H + GAP + r * (tile + CAPTION_H + GAP)
        sheet.paste(_open(paths[s], SHEET_SCALE), (x, y))
        t = media.step_time(s, fps)
        labels = media.active_labels(diagnosis, t)
        d.text((x, y + tile + 4), f"t = {t:.1f} s" + (f"  {', '.join(labels)}" if labels else ""), fill=(55, 65, 81),
               font=font)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out


def rules_diagnosis(ep_dir: Path) -> Diagnosis:
    """The rules detector on the recorded steps (step i at i / fps), so its times match the frames exactly.

    The rules read only the trajectory (stillness, jerk), so placeholder sim signals are enough."""
    meta, arrays, _ = load_episode(ep_dir)
    n = meta.n_steps
    q = np.asarray(arrays["ee_quat"], dtype=np.float64)
    traj = Trajectory.from_arrays(np.arange(n) / meta.fps, np.asarray(arrays["ee_pos"], dtype=np.float64),
                                  q / np.linalg.norm(q, axis=1, keepdims=True), np.asarray(arrays["gripper"], dtype=int))
    signals = SimSignals(np.zeros((n, 3)), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n))
    return detect_rules(traj, compute_windows(traj, signals), meta.task_text)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--episode", type=Path, required=True)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--diagnosis", type=Path, help="Diagnosis or stored diagnosis JSON for --episode")
    g.add_argument("--rules", action="store_true", help="diagnose --episode's recorded steps with the rules")
    p.add_argument("--compare", type=Path, help="a second episode to show side by side (e.g. the perfected one)")
    p.add_argument("--compare-diagnosis", type=Path)
    p.add_argument("--labels", default="raw,perfected", help="side-by-side labels, comma-separated")
    p.add_argument("--camera", default="front")
    p.add_argument("--gif-fps", type=float, default=10.0)
    p.add_argument("--scale", type=int, default=SCALE, help="GIF pixels per sim pixel")
    p.add_argument("--colors", type=int, default=COLORS, help="shared GIF palette size (0: 256 per frame)")
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args(argv)

    def read(path: Path | None) -> Diagnosis | None:
        return None if path is None else media.load_diagnosis(json.loads(path.read_text(encoding="utf-8")))

    diag = rules_diagnosis(args.episode) if args.rules else read(args.diagnosis)
    meta, _, _ = load_episode(args.episode)
    written = [render_gif(args.episode, args.out / f"{meta.demo_id}.gif", diag, camera=args.camera, gif_fps=args.gif_fps,
                          scale=args.scale, colors=args.colors),
               render_contact_sheet(args.episode, args.out / f"{meta.demo_id}_sheet.png", diag, camera=args.camera)]
    if args.compare is not None:
        other, _, _ = load_episode(args.compare)
        labels = tuple(args.labels.split(",", 1)) if "," in args.labels else (args.labels, other.demo_id)
        written.append(render_side_by_side(args.episode, args.compare,
                                           args.out / f"{meta.demo_id}_vs_{other.demo_id}.gif", labels=labels,
                                           diagnoses=(diag, read(args.compare_diagnosis)), camera=args.camera,
                                           gif_fps=args.gif_fps, scale=args.scale, colors=args.colors))
    for w in written:
        print(f"wrote {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
