"""ACT training smoke test: can LeRobot train on this Windows box?

Builds 10 synthetic episodes x 100 frames (front + wrist 128x128), exports them with export_episodes, runs the stock
`lerobot-train` CLI for <= 300 steps at batch <= 8, then reloads the saved checkpoint and runs one select_action.
Records steps/s, peak VRAM (nvidia-smi, whole GPU) and the outcome in <work-dir>/results.json.

Run in the lerobot venv from the repo root:
    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.train_smoke
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

from sim_worker.own_code import check_own_code, put_own_code_first

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode  # noqa: E402
from lerobot_tools.export import export_episodes  # noqa: E402

TASK = "pick up the red cube and place it in the blue bin"
REPO_ID = "local/t3_act_smoke"
N_JOINTS = 9
IMG = 128
FPS = 50
MAX_STEPS, MAX_BATCH = 300, 8  # sprint-1 GPU budget (Isaac shares the GPU)
VIDEO_BACKEND = "pyav"  # torchcodec can't load here; see docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md


def _frame(step: int, n: int, color: tuple[int, int, int], rng: np.random.Generator) -> np.ndarray:
    """A square moving across a gradient: compressible like real video, unlike pure noise."""
    img = np.zeros((IMG, IMG, 3), dtype=np.uint8)
    img[..., 2] = np.linspace(40, 120, IMG, dtype=np.uint8)[None, :]
    x = int((IMG - 24) * step / max(n - 1, 1))
    y = int(rng.integers(40, 60))
    img[y:y + 24, x:x + 24] = color
    return img


def make_synthetic_episodes(root: Path, n_episodes: int = 10, n_steps: int = 100, seed: int = 0) -> list[Path]:
    rng = np.random.default_rng(seed)
    dirs = []
    for e in range(n_episodes):
        # Smooth joint paths, action = next joint position (what a position-target policy would learn).
        t = np.linspace(0, 1, n_steps + 1)[:, None]
        phase = rng.uniform(0, np.pi, size=(1, N_JOINTS))
        joints = (0.5 * np.sin(2 * np.pi * t + phase)).astype(np.float32)
        quat = np.tile([1.0, 0.0, 0.0, 0.0], (n_steps, 1))
        arrays = {
            "joint_pos": joints[:-1],
            "action": joints[1:],
            "ee_pos": rng.normal(size=(n_steps, 3)),
            "ee_quat": quat,
            "gripper": (np.arange(n_steps) >= n_steps // 2).astype(np.int8),
        }
        meta = EpisodeMeta(demo_id=f"smoke_{e:02d}", robot="franka", task_text=TASK, fps=FPS, n_steps=n_steps,
                           cameras=["front", "wrist"])
        ep_dir = save_episode(root / meta.demo_id, meta, arrays)
        for cam, color in (("front", (220, 30, 30)), ("wrist", (30, 220, 30))):
            for i in range(n_steps):
                Image.fromarray(_frame(i, n_steps, color, rng)).save(image_path(ep_dir, cam, i))
        dirs.append(ep_dir)
    return dirs


class VramPoller(threading.Thread):
    """Polls nvidia-smi total GPU memory used (MiB). Per-process numbers are N/A under WDDM, so this is whole-GPU."""

    def __init__(self, interval_s: float = 0.5):
        super().__init__(daemon=True)
        self.interval_s, self.samples, self._halt = interval_s, [], threading.Event()

    @staticmethod
    def read_mib() -> int | None:
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=10).stdout
            return int(out.strip().splitlines()[0])
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            return None

    def run(self):
        while not self._halt.is_set():
            if (v := self.read_mib()) is not None:
                self.samples.append(v)
            self._halt.wait(self.interval_s)

    def stop(self):
        self._halt.set()
        self.join(timeout=5)


def train(dataset_root: Path, out_dir: Path, steps: int, batch_size: int, log_path: Path) -> dict:
    exe = Path(sys.executable).with_name("lerobot-train.exe")
    cmd = [
        str(exe),
        "--policy.type=act", "--policy.device=cuda", "--policy.push_to_hub=false",
        f"--dataset.repo_id={REPO_ID}", f"--dataset.root={dataset_root}", f"--dataset.video_backend={VIDEO_BACKEND}",
        f"--output_dir={out_dir}", f"--steps={steps}", f"--batch_size={batch_size}",
        f"--save_freq={steps}", "--log_freq=50", "--wandb.enable=false",
    ]
    poller = VramPoller()
    baseline = VramPoller.read_mib()
    poller.start()
    t0 = time.perf_counter()
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, text=True)
    wall = time.perf_counter() - t0
    poller.stop()
    text = log_path.read_text(encoding="utf-8", errors="replace")
    last_lines = text.strip().splitlines()[-25:]
    return {
        "cmd": cmd,
        "exit_code": proc.returncode,
        "wall_s_including_startup": round(wall, 1),
        **parse_train_log(text),
        "vram_baseline_mib": baseline,
        "vram_peak_mib": max(poller.samples) if poller.samples else None,
        "log_tail": last_lines if proc.returncode != 0 else last_lines[-5:],
    }


_STEP_LINE = re.compile(
    r"step:(?P<step>\d+)(?P<k>K?)\s.*?\sloss:(?P<loss>[\d.]+)\s.*?updt_s:(?P<updt>[\d.]+)\s+data_s:(?P<data>[\d.]+)"
    r"(?:.*?mem_gb:(?P<mem>[\d.]+))?"
)


def _logged_steps(rows: list[dict]) -> list[int]:
    """lerobot prints steps >= 1000 as "1K", "2K" (no decimals), so 1000 and 1050 look alike. Continue the interval
    seen between the last two exact steps; without one, read "NK" as N*1000."""
    steps: list[int] = []
    for r in rows:
        if not r["k"]:
            steps.append(int(r["step"]))
        elif len(steps) >= 2 and steps[-1] - steps[-2] > 0:
            steps.append(steps[-1] + steps[-1] - steps[-2])
        else:
            steps.append(int(r["step"]) * 1000)
    return steps


def parse_train_log(text: str) -> dict:
    """Parse lerobot-train's periodic lines, e.g.
    "step:300 smpl:2K ep:24 epch:2.40 loss:2.994 grdn:84.161 lr:1.0e-05 updt_s:0.047 data_s:0.005 smp/s:155 mem_gb:0.97 l1_loss:..."
    The first window includes CUDA/cuDNN warmup, so steady-state speed excludes it.
    """
    rows = [m.groupdict() for m in _STEP_LINE.finditer(text)]
    if not rows:
        return {"logged_steps": [], "loss_curve": []}
    s_per_step = [float(r["updt"]) + float(r["data"]) for r in rows]
    steady = s_per_step[1:] or s_per_step
    mems = [float(r["mem"]) for r in rows if r["mem"]]
    steps = _logged_steps(rows)
    return {
        "logged_steps": steps,
        "loss_curve": [[s, float(r["loss"])] for s, r in zip(steps, rows)],
        "s_per_step_first_window": round(s_per_step[0], 3),
        "steps_per_s_steady": round(1.0 / float(np.mean(steady)), 1),
        "loss_first_last": [float(rows[0]["loss"]), float(rows[-1]["loss"])],
        "torch_peak_mem_gb_lerobot": max(mems) if mems else None,
    }


def reload_and_act(checkpoint: Path, dataset_root: Path) -> dict:
    import torch
    from lerobot.datasets.lerobot_dataset import LeRobotDataset
    from lerobot.policies.act.modeling_act import ACTPolicy
    from lerobot.policies.factory import make_pre_post_processors

    policy = ACTPolicy.from_pretrained(str(checkpoint))
    policy.to("cuda").eval()
    pre, post = make_pre_post_processors(
        policy.config, pretrained_path=str(checkpoint),
        preprocessor_overrides={"device_processor": {"device": "cuda"}},
    )
    sample = LeRobotDataset(REPO_ID, root=dataset_root, video_backend=VIDEO_BACKEND)[0]
    obs = {k: v for k, v in sample.items() if k.startswith("observation.") or k == "task"}
    with torch.no_grad():
        action = post(policy.select_action(pre(obs)))
    return {"reloaded": True, "action_shape": list(action.shape), "action_finite": bool(torch.isfinite(action).all())}


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--work-dir", type=Path, default=None, help="default: data/runs/t3_act_smoke_<timestamp>")
    p.add_argument("--steps", type=int, default=MAX_STEPS)
    p.add_argument("--batch-size", type=int, default=MAX_BATCH)
    args = p.parse_args(argv)
    if not (0 < args.steps <= MAX_STEPS and 0 < args.batch_size <= MAX_BATCH):
        p.error(f"sprint-1 GPU budget: steps <= {MAX_STEPS}, batch <= {MAX_BATCH}")

    work = args.work_dir or Path("data/runs") / f"t3_act_smoke_{datetime.now():%Y%m%d_%H%M%S}"
    work.mkdir(parents=True, exist_ok=False)
    results: dict = {"work_dir": str(work.resolve()), "steps": args.steps, "batch_size": args.batch_size}

    t0 = time.perf_counter()
    eps = make_synthetic_episodes(work / "episodes")
    dataset_root = export_episodes(eps, work / "dataset", repo_id=REPO_ID, fps=FPS)
    results["export_s"] = round(time.perf_counter() - t0, 1)

    train_dir = work / "train"
    results["train"] = train(dataset_root, train_dir, args.steps, args.batch_size, work / "train.log")

    step_ckpts = sorted((train_dir / "checkpoints").glob("[0-9]*/pretrained_model")) if train_dir.exists() else []
    results["checkpoint"] = str(step_ckpts[-1]) if step_ckpts else None
    results["last_link_exists"] = (train_dir / "checkpoints" / "last").exists()
    if step_ckpts:
        try:
            results["reload"] = reload_and_act(step_ckpts[-1], dataset_root)
        except Exception as e:  # recorded, not hidden: this is a feasibility probe
            results["reload"] = {"reloaded": False, "error": f"{type(e).__name__}: {e}"}

    (work / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))
    ok = results["checkpoint"] is not None and results.get("reload", {}).get("reloaded", False)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
