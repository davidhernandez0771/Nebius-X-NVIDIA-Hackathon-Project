"""scripts/make_media.py: GIFs and a contact sheet from recorded episodes (Pillow; skipped without it)."""
from __future__ import annotations

import json

import numpy as np
import pytest

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

from demo_pipeline import media  # noqa: E402
from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode  # noqa: E402
from demo_pipeline.rules import TASK_TEXT  # noqa: E402
from demo_pipeline.schemas import Diagnosis  # noqa: E402
from scripts import make_media as mm  # noqa: E402

FPS = 50


def _episode(root, name="ep", n=40, size=32, cameras=("front",)):
    """A tiny episode: n steps whose front frames are flat colours that change with the step."""
    ep = root / name
    pos = np.stack([np.linspace(0.4, 0.5, n), np.zeros(n), np.full(n, 0.2)], axis=1)
    arrays = {"joint_pos": np.zeros((n, 9)), "action": np.zeros((n, 9)), "ee_pos": pos,
              "ee_quat": np.tile([0.0, 1.0, 0.0, 0.0], (n, 1)), "gripper": (np.arange(n) >= n // 2).astype(np.int8)}
    save_episode(ep, EpisodeMeta(demo_id=name, robot="franka", task_text=TASK_TEXT, fps=FPS, n_steps=n,
                                 cameras=list(cameras)), arrays)
    for cam in cameras:
        for i in range(n):
            Image.new("RGB", (size, size), (i * 5 % 256, 80, 160)).save(image_path(ep, cam, i))
    return ep


def _diag():
    return Diagnosis.model_validate({
        "segments": [{"name": "approach", "t0": 0.0, "t1": 0.4}, {"name": "carry", "t0": 0.4, "t1": 0.8}],
        "issues": [{"type": "pause", "t0": 0.2, "t1": 0.3, "evidence": "e"},
                   {"type": "grasp_off_center", "t": 0.4, "evidence": "e"}],
        "repairs": [], "decision": "repair", "label": TASK_TEXT})


def _hex(c: str) -> tuple[int, int, int]:
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def test_a_composed_frame_has_the_timeline_with_its_issue_marks_and_cursor():
    frame = Image.new("RGB", (32, 32), (10, 20, 30))
    lay = media.timeline_layout(_diag(), duration=0.8, width=32 * mm.SCALE)
    img = mm.compose_frame(frame, lay, t=0.6)
    assert img.size == (32 * mm.SCALE, 32 * mm.SCALE + mm.TIMELINE_H)
    top = 32 * mm.SCALE
    pause = lay.issues[0]
    assert img.getpixel(((pause.x0 + pause.x1) // 2, top + mm.ISSUE_Y + 2)) == _hex(media.ISSUE_COLORS["pause"])
    approach = lay.segments[0]
    assert img.getpixel(((approach.x0 + approach.x1) // 2, top + mm.SEGMENT_Y + 2)) == \
        _hex(media.SEGMENT_COLORS["approach"])
    assert img.getpixel((lay.bar.x(0.6), top + 2)) == mm.CURSOR


def test_gif_has_one_frame_per_gif_step_and_real_time_delays(tmp_path):
    ep = _episode(tmp_path, n=40)
    out = mm.render_gif(ep, tmp_path / "ep.gif", diagnosis=_diag(), gif_fps=10)
    steps, ms = media.gif_frames(40, FPS, 10)
    with Image.open(out) as gif:
        assert gif.n_frames == len(steps) == 9
        assert gif.size == (32 * mm.SCALE, 32 * mm.SCALE + mm.TIMELINE_H)
        delays = []
        for k in range(gif.n_frames):
            gif.seek(k)
            delays.append(gif.info["duration"])
    assert delays == ms


def test_side_by_side_puts_two_labelled_episodes_next_to_each_other(tmp_path):
    a, b = _episode(tmp_path, "raw", n=40), _episode(tmp_path, "perfected", n=20)
    out = mm.render_side_by_side(a, b, tmp_path / "pair.gif", labels=("raw", "perfected"))
    pairs, _ = media.pair_frames(40, 20, FPS, 10)
    with Image.open(out) as gif:
        assert gif.n_frames == len(pairs)
        w = 32 * mm.SCALE
        assert gif.size == (2 * w + mm.GAP, mm.LABEL_H + w + mm.TIMELINE_H)


def test_contact_sheet_has_six_captioned_tiles(tmp_path):
    ep = _episode(tmp_path, n=40)
    out = mm.render_contact_sheet(ep, tmp_path / "sheet.png", diagnosis=_diag())
    with Image.open(out) as sheet:
        tile = 32 * mm.SHEET_SCALE
        assert sheet.size == (3 * tile + 4 * mm.GAP, mm.LABEL_H + 2 * (tile + mm.CAPTION_H) + 3 * mm.GAP)
        # tile k shows step select_frames(40, 6)[k]: its colour encodes the step
        steps = media.select_frames(40, 6)
        x, y = mm.GAP + tile // 2, mm.LABEL_H + mm.GAP + tile // 2
        assert sheet.convert("RGB").getpixel((x, y))[0] == steps[0] * 5 % 256
        assert sheet.convert("RGB").getpixel((x + tile + mm.GAP, y))[0] == steps[1] * 5 % 256


def test_a_missing_camera_is_a_clear_error(tmp_path):
    ep = _episode(tmp_path, n=10, cameras=())
    with pytest.raises(ValueError, match="front"):
        mm.render_gif(ep, tmp_path / "x.gif")


def test_rules_diagnosis_comes_from_the_recorded_steps(tmp_path):
    ep = _episode(tmp_path, n=60)
    diag = mm.rules_diagnosis(ep)
    assert isinstance(diag, Diagnosis) and diag.segments[0].name == "approach"


def test_cli_makes_all_three_files(tmp_path, capsys):
    a, b = _episode(tmp_path, "raw", n=40), _episode(tmp_path, "perfected", n=30)
    dpath = tmp_path / "diagnosis.json"
    dpath.write_text(json.dumps({"source": "rules", "model_id": None, "diagnosis": _diag().model_dump(mode="json")}),
                     encoding="utf-8")
    out = tmp_path / "media"
    assert mm.main(["--episode", str(a), "--diagnosis", str(dpath), "--compare", str(b),
                    "--labels", "raw,perfected", "--out", str(out)]) == 0
    assert sorted(p.name for p in out.iterdir()) == ["raw.gif", "raw_sheet.png", "raw_vs_perfected.gif"]
    assert "raw_vs_perfected.gif" in capsys.readouterr().out


def test_scale_sets_the_gif_size(tmp_path):
    ep = _episode(tmp_path, n=20)
    with Image.open(mm.render_gif(ep, tmp_path / "s.gif", scale=1)) as gif:
        assert gif.size == (32, 32 + mm.TIMELINE_H)
