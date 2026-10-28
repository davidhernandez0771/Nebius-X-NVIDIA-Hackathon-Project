"""Tests for the symlink-free training wrapper (lerobot_tools/train.py).

The pointer tests are pure and run in any venv. The patch test needs lerobot (C:\\venvs\\lerobot). The 1,000-step
integration run also needs CUDA and the GPU, so it only runs with T3_GPU_TESTS=1:
    $env:T3_GPU_TESTS="1"; C:\\venvs\\lerobot\\Scripts\\python.exe -m pytest -q lerobot_tools\\tests\\test_train.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from lerobot_tools.train import (
    LAST_POINTER,
    MAX_STEPS,
    build_lerobot_argv,
    resolve_last_checkpoint,
    update_last_checkpoint_pointer,
)


def _step_dir(checkpoints: Path, name: str) -> Path:
    d = checkpoints / name / "pretrained_model"
    d.mkdir(parents=True)
    (d / "config.json").write_text("{}", encoding="utf-8")
    return d.parent


def test_pointer_names_latest_checkpoint_without_symlink(tmp_path):
    ckpts = tmp_path / "checkpoints"
    first = _step_dir(ckpts, "000250")
    update_last_checkpoint_pointer(first)
    second = _step_dir(ckpts, "000500")
    update_last_checkpoint_pointer(second)

    assert (ckpts / LAST_POINTER).read_text(encoding="utf-8").strip() == "000500"
    assert not (ckpts / "last").exists()  # no symlink, no copy
    assert resolve_last_checkpoint(ckpts) == second


def test_resolve_accepts_run_output_dir(tmp_path):
    step = _step_dir(tmp_path / "checkpoints", "001000")
    update_last_checkpoint_pointer(step)
    assert resolve_last_checkpoint(tmp_path) == step


def test_resolve_missing_pointer_raises(tmp_path):
    (tmp_path / "checkpoints").mkdir()
    with pytest.raises(FileNotFoundError):
        resolve_last_checkpoint(tmp_path)


def test_resolve_pointer_to_missing_step_raises(tmp_path):
    ckpts = tmp_path / "checkpoints"
    ckpts.mkdir()
    (ckpts / LAST_POINTER).write_text("000750\n", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        resolve_last_checkpoint(ckpts)


def test_argv_defaults_to_pyav_and_keeps_user_args():
    argv = build_lerobot_argv(["--steps=100", "--batch_size=8"])
    assert "--dataset.video_backend=pyav" in argv
    assert argv[:2] == ["--steps=100", "--batch_size=8"]
    assert build_lerobot_argv(["--dataset.video_backend=torchcodec"]).count("--dataset.video_backend=pyav") == 0


def test_argv_resume_last_points_config_path_at_resolved_checkpoint(tmp_path):
    step = _step_dir(tmp_path / "checkpoints", "000500")
    update_last_checkpoint_pointer(step)
    argv = build_lerobot_argv(["--steps=1000"], resume_last=tmp_path)
    assert "--resume=true" in argv
    assert f"--config_path={step / 'pretrained_model'}" in argv


@pytest.mark.parametrize("bad", [["--batch_size=16"], ["--steps=200001"], ["--batch_size", "9"]])
def test_argv_enforces_sprint_gpu_budget(bad):
    with pytest.raises(ValueError, match="budget"):
        build_lerobot_argv(bad)


def test_sprint7_budget_allows_30k_steps_at_batch_8():
    assert build_lerobot_argv(["--steps=30000", "--batch_size=8"])[:2] == ["--steps=30000", "--batch_size=8"]


def test_patch_replaces_lerobot_symlink_function(tmp_path):
    pytest.importorskip("lerobot")
    import lerobot.common.train_utils as train_utils
    import lerobot.scripts.lerobot_train as lerobot_train

    from lerobot_tools.train import patch_lerobot

    patch_lerobot()
    assert lerobot_train.update_last_checkpoint is update_last_checkpoint_pointer
    assert train_utils.update_last_checkpoint is update_last_checkpoint_pointer
    step = _step_dir(tmp_path / "checkpoints", "000250")
    lerobot_train.update_last_checkpoint(step)  # what lerobot calls after every save
    assert resolve_last_checkpoint(tmp_path) == step


@pytest.mark.skipif(os.environ.get("T3_GPU_TESTS") != "1", reason="GPU integration run; set T3_GPU_TESTS=1")
def test_1000_step_run_with_four_saves_exits_zero(tmp_path):
    """Review Focus 4: a run longer than one checkpoint save must finish with exit 0 on Windows."""
    pytest.importorskip("lerobot")
    from lerobot_tools.export import export_episodes
    from lerobot_tools.train_smoke import FPS, REPO_ID, make_synthetic_episodes, parse_train_log

    dataset = export_episodes(make_synthetic_episodes(tmp_path / "episodes"), tmp_path / "dataset",
                              repo_id=REPO_ID, fps=FPS)
    out = tmp_path / "train"
    log = Path(os.environ.get("T3_TRAIN_LOG", tmp_path / "train.log"))
    cmd = [sys.executable, "-m", "lerobot_tools.train",
           "--policy.type=act", "--policy.device=cuda", "--policy.push_to_hub=false",
           f"--dataset.repo_id={REPO_ID}", f"--dataset.root={dataset}", f"--output_dir={out}",
           "--steps=1000", "--save_freq=250", "--batch_size=8", "--log_freq=50", "--wandb.enable=false"]
    with log.open("w", encoding="utf-8") as f:
        proc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=Path(__file__).parents[2])
    text = log.read_text(encoding="utf-8", errors="replace")
    assert proc.returncode == 0, text[-3000:]

    ckpts = sorted(p.name for p in (out / "checkpoints").iterdir() if p.is_dir())
    assert ckpts == ["000250", "000500", "000750", "001000"]
    last = resolve_last_checkpoint(out)
    assert last.name == "001000"
    assert (last / "pretrained_model" / "model.safetensors").is_file()
    print("\nT3 train speed:", parse_train_log(text))


@pytest.mark.skipif(os.environ.get("T3_GPU_TESTS") != "1", reason="GPU integration run; set T3_GPU_TESTS=1")
def test_resume_last_continues_from_pointer(tmp_path):
    """`--resume-last <output_dir>` resumes stock lerobot-train from checkpoints/last.txt, still with no symlink."""
    pytest.importorskip("lerobot")
    from lerobot_tools.export import export_episodes
    from lerobot_tools.train_smoke import FPS, REPO_ID, make_synthetic_episodes, parse_train_log

    dataset = export_episodes(make_synthetic_episodes(tmp_path / "episodes", n_episodes=4), tmp_path / "dataset",
                              repo_id=REPO_ID, fps=FPS)
    out = tmp_path / "train"
    base = [sys.executable, "-m", "lerobot_tools.train", "--batch_size=8", "--save_freq=150", "--log_freq=50"]
    first = base + ["--policy.type=act", "--policy.device=cuda", "--policy.push_to_hub=false",
                    f"--dataset.repo_id={REPO_ID}", f"--dataset.root={dataset}", f"--output_dir={out}",
                    "--steps=300", "--wandb.enable=false"]
    repo = Path(__file__).parents[2]
    r1 = subprocess.run(first, capture_output=True, text=True, errors="replace", cwd=repo)
    assert r1.returncode == 0, r1.stderr[-3000:]
    r2 = subprocess.run(base + ["--resume-last", str(out), "--steps=450"], capture_output=True, text=True,
                        errors="replace", cwd=repo)
    assert r2.returncode == 0, r2.stderr[-3000:]

    # Resumed, not restarted: the first logged step is past the checkpoint.
    assert parse_train_log(r2.stdout + r2.stderr)["logged_steps"][0] == 350
    ckpts = sorted(p.name for p in (out / "checkpoints").iterdir() if p.is_dir())
    assert ckpts == ["000150", "000300", "000450"]
    assert resolve_last_checkpoint(out).name == "000450"


def test_grasp_fix_run2_budget_allows_60k_steps_at_batch_8():
    # T3 grasp-fix run 2 (recovery copies + longer training) trains to 60k; the step count is chosen on practice seeds
    assert build_lerobot_argv(["--steps=60000", "--batch_size=8"])[:2] == ["--steps=60000", "--batch_size=8"]


def test_the_budget_allows_80k_and_100k_steps_at_batch_8():
    # 2026-10-20 research note, Stage 1: train to 80k (LeRobot's ACT reference runs ~80-100k) and select on practice seeds
    assert MAX_STEPS >= 100_000
    assert build_lerobot_argv(["--steps=80000", "--batch_size=8"])[:2] == ["--steps=80000", "--batch_size=8"]
    assert build_lerobot_argv(["--steps=100000", "--batch_size=8"])[:2] == ["--steps=100000", "--batch_size=8"]


def test_the_big_test_budget_allows_180k_steps_and_caps_at_200k():
    # 2026-10-23 big test (lead-approved): 180k steps at batch 8, candidates 60k/120k/180k; the cap is 200k
    assert MAX_STEPS == 200_000
    assert build_lerobot_argv(["--steps=180000", "--batch_size=8"])[:2] == ["--steps=180000", "--batch_size=8"]
    with pytest.raises(ValueError, match="200000"):
        build_lerobot_argv(["--steps=200001", "--batch_size=8"])
