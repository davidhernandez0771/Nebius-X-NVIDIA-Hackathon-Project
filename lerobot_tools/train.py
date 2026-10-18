"""Run `lerobot-train` in-process with Windows-safe checkpoints.

Stock lerobot 0.6.1 makes `checkpoints/last` a symlink after every save. Windows refuses that without admin rights or
Developer Mode (WinError 1314), so a run dies at its first `--save_freq`. This wrapper replaces
`update_last_checkpoint` with one that writes `checkpoints/last.txt` (the step dir name, e.g. "000750"), then calls
lerobot's own train entry point. Training itself is untouched. Video decoding defaults to PyAV, because torchcodec
can't load on this machine (see docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md).

Resume: `lerobot-train --resume=true` never reads `last`; it takes `--config_path=<step>/pretrained_model`. Use
`--resume-last <output_dir>` here and the wrapper fills that in from last.txt.

Run in the lerobot venv from the repo root (all other args go to lerobot-train unchanged):
    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.train --policy.type=act --dataset.repo_id=... ...
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

LAST_POINTER = "last.txt"
VIDEO_BACKEND = "pyav"
MAX_STEPS, MAX_BATCH = 60_000, 8  # GPU budget: sprint 3 set 10k; sprint 7 30k for equal epochs; grasp-fix run 2 60k


def update_last_checkpoint_pointer(checkpoint_dir: Path) -> Path:
    """Drop-in for lerobot's update_last_checkpoint: record the latest step dir in `<checkpoints>/last.txt`."""
    checkpoint_dir = Path(checkpoint_dir)
    pointer = checkpoint_dir.parent / LAST_POINTER
    tmp = pointer.with_name(LAST_POINTER + ".tmp")
    tmp.write_text(checkpoint_dir.name + "\n", encoding="utf-8")
    os.replace(tmp, pointer)  # atomic, so a crash mid-save never leaves a half-written pointer
    return pointer


def resolve_last_checkpoint(path: Path) -> Path:
    """Latest step checkpoint dir, given a run output dir or its `checkpoints/` dir."""
    path = Path(path)
    checkpoints = path / "checkpoints" if (path / "checkpoints").is_dir() else path
    pointer = checkpoints / LAST_POINTER
    if not pointer.is_file():
        raise FileNotFoundError(f"no {LAST_POINTER} in {checkpoints}")
    step_dir = checkpoints / pointer.read_text(encoding="utf-8").strip()
    if not step_dir.is_dir():
        raise FileNotFoundError(f"{pointer} points at missing checkpoint {step_dir}")
    return step_dir


def _arg_value(argv: list[str], name: str) -> str | None:
    """Value of `--name=v` or `--name v` (last one wins, like draccus)."""
    value = None
    for i, tok in enumerate(argv):
        if tok.startswith(f"--{name}="):
            value = tok.split("=", 1)[1]
        elif tok == f"--{name}" and i + 1 < len(argv):
            value = argv[i + 1]
    return value


def build_lerobot_argv(argv: list[str], resume_last: Path | None = None) -> list[str]:
    """lerobot-train args: the user's, plus pyav decoding and resume-from-last.txt. Enforces the GPU budget."""
    out = list(argv)
    for name, cap in (("steps", MAX_STEPS), ("batch_size", MAX_BATCH)):
        v = _arg_value(out, name)
        if v is not None and int(v) > cap:
            raise ValueError(f"sprint GPU budget: --{name} must be <= {cap}, got {v}")
    if _arg_value(out, "dataset.video_backend") is None:
        out.append(f"--dataset.video_backend={VIDEO_BACKEND}")
    if resume_last is not None:
        out += ["--resume=true", f"--config_path={resolve_last_checkpoint(resume_last) / 'pretrained_model'}"]
    return out


def patch_lerobot() -> None:
    """Point both lerobot references at the symlink-free version (lerobot_train imported it by name)."""
    import lerobot.common.train_utils as train_utils
    import lerobot.scripts.lerobot_train as lerobot_train

    train_utils.update_last_checkpoint = update_last_checkpoint_pointer
    lerobot_train.update_last_checkpoint = update_last_checkpoint_pointer


def run(lerobot_argv: list[str]) -> None:
    """Patch, then run lerobot-train in this process with `lerobot_argv` (see build_lerobot_argv)."""
    patch_lerobot()
    import lerobot.scripts.lerobot_train as lerobot_train

    saved = sys.argv
    sys.argv = ["lerobot-train", *lerobot_argv]  # lerobot's parser reads sys.argv
    try:
        lerobot_train.main()
    finally:
        sys.argv = saved


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--resume-last", type=Path, default=None, metavar="OUTPUT_DIR",
                   help="resume the run in OUTPUT_DIR from checkpoints/last.txt")
    args, rest = p.parse_known_args(argv)
    try:
        lerobot_argv = build_lerobot_argv(rest, args.resume_last)
    except (ValueError, FileNotFoundError) as e:
        p.error(str(e))
    run(lerobot_argv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
