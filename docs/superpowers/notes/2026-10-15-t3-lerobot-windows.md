# LeRobot on Windows: install + verification (T3, 2026-10-15)

## Version (looked up 2026-10-15)

- Source: PyPI JSON (`https://pypi.org/pypi/lerobot/json`), GitHub README, HF docs
  `lerobot-dataset-v3`, and the `v0.6.1` tag of `src/lerobot/datasets/lerobot_dataset.py`.
- **Current release: `lerobot 0.6.1`** (uploaded 2026-08-03). Earlier: 0.6.0 (2026-07-06), 0.5.1, 0.5.0.
- `requires_python >= 3.12`. Pins `torch>=2.7,<2.12`, `numpy>=2.0,<2.3`.
- **Dataset format: `LeRobotDataset v3.0`** (`lerobot.datasets.dataset_metadata.CODEBASE_VERSION == "v3.0"`, checked in the installed package).
- The base package does NOT include the dataset stack. `datasets`, `pyarrow`, `pandas`, `av`, `torchcodec` come with the
  `[dataset]` extra; `lerobot-train` additionally needs the `[training]` extra (`accelerate`, `wandb`).

## Dataset API (v0.6.1, verified against the installed source)

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

features = {
    "observation.state": {"dtype": "float32", "shape": (J,), "names": [...]},
    "action":            {"dtype": "float32", "shape": (J,), "names": [...]},
    "observation.images.front": {"dtype": "video", "shape": (H, W, 3), "names": ["height", "width", "channels"]},
}
ds = LeRobotDataset.create(repo_id, fps=50, features=features, root=out_dir,  # root must NOT exist yet (mkdir exist_ok=False)
                           robot_type="franka", use_videos=True)
ds.add_frame({"observation.state": s, "action": a, "observation.images.front": img_hwc_uint8, "task": text})
#   "task" is required in every frame; "timestamp"/"frame_index"/"index" must NOT be passed (auto-filled from fps).
#   Images: np.ndarray HWC or CHW, or PIL.Image.
ds.save_episode()            # optional episode_data=; no custom per-episode metadata parameter
ds.finalize()                # REQUIRED, otherwise the parquet footers are missing and the dataset won't load

ds = LeRobotDataset(repo_id, root=out_dir, video_backend="pyav")   # load (see torchcodec below)
ds.num_episodes, ds.num_frames, ds.meta.features, ds.meta.episodes[i]["length"]
ds[i] -> dict of tensors + "task" (str)
```

Layout: `meta/info.json`, `meta/stats.json`, `meta/tasks.*`, `meta/episodes/*.parquet`, `data/chunk-*/file-*.parquet`,
`videos/<key>/chunk-*/file-*.mp4` (many episodes per file).

Train: `lerobot-train --policy.type=act --dataset.repo_id=<id> --dataset.root=<dir> ...`

## Install (what was run)

```
$env:UV_LINK_MODE="copy"
uv venv --python 3.12 C:\venvs\lerobot                     # CPython 3.12.14
uv pip install --python C:\venvs\lerobot\Scripts\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python C:\venvs\lerobot\Scripts\python.exe "lerobot[dataset,training]==0.6.1" pytest
uv pip install --python C:\venvs\lerobot\Scripts\python.exe -e C:\dev\pm-t3 --no-deps
```

Resulting key versions: torch 2.11.0+cu128, torchvision 0.26.0+cu128, lerobot 0.6.1, numpy 2.2.6, datasets 4.8.5,
pyarrow 26.0.0, av 15.1.0, torchcodec 0.11.1, accelerate 1.15.0, wandb 0.27.2, pydantic 2.14.1, pytest 9.1.1.
The CUDA torch build was kept (lerobot's pins accept 2.11; uv did not replace it).

## Verification

```
> C:\venvs\lerobot\Scripts\python.exe -c "import torch, lerobot; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
2.11.0+cu128 True NVIDIA GeForce RTX 5080
```

`from demo_pipeline.episode_io import load_episode` works in this venv.

## Problems found

1. **torchcodec cannot load on this machine.** `from torchcodec.decoders import VideoDecoder` fails:
   `RuntimeError: Could not load libtorchcodec ... We support versions 4, 5, 6, 7, and 8 ... On Windows, ensure you've
   installed the "full-shared" version which ships DLLs.` / `FileNotFoundError: Could not find module
   '...\torchcodec\libtorchcodec_core8.dll' (or one of its dependencies)`.
   Cause: the only system FFmpeg is the WinGet `Gyan.FFmpeg` **9.0 full_build (static, no DLLs)**; torchcodec needs
   shared FFmpeg 4–8. `lerobot-info` crashes on the same error.
   **Workaround inside LeRobot (no install):** decode with PyAV, which bundles its own FFmpeg:
   `LeRobotDataset(..., video_backend="pyav")` and `lerobot-train ... --dataset.video_backend=pyav`.
   A real fix (human decision): install a *shared* FFmpeg 7 or 8 and put its `bin` on PATH.
2. **pydantic is not a LeRobot dependency.** The repo is installed with `--no-deps`, so `demo_pipeline` needs pydantic
   from somewhere. It is currently present only because `wandb` (from `lerobot[training]`) depends on it. A venv built
   with only `lerobot[dataset]` gives `ModuleNotFoundError: No module named 'pydantic'` on `import demo_pipeline.episode_io`.
   Recommendation: add `pydantic` explicitly to the lerobot venv recipe.

## ACT training smoke (Task 3), 2026-10-15 17:05

`C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.train_smoke` (results in
`data/runs/t3_act_smoke_20261015_170519/results.json`, git-ignored). Data: 10 synthetic episodes x 100 frames,
9-joint state/action, front + wrist video at 128x128, exported with `lerobot_tools.export.export_episodes`.
Command: stock `lerobot-train --policy.type=act --policy.device=cuda --policy.push_to_hub=false
--dataset.video_backend=pyav --steps=300 --batch_size=8 --save_freq=300 --log_freq=50`.

| Measure | Result |
|---|---|
| Training ran 300/300 steps on CUDA | yes |
| Steady-state speed (steps 51-300, `updt_s + data_s`) | **20.7 steps/s** (~0.048 s/step; tqdm showed 20.6 it/s) |
| First 50 steps (warmup) | 0.557 s/step |
| Loss (step 50 -> 300) | 14.974 -> 2.994 |
| Torch peak memory, as logged by lerobot (`mem_gb`) | **0.99 GB** |
| Whole-GPU peak (nvidia-smi, 0.5 s polling) | 7184 MiB (baseline 1183 MiB). Not ours alone: Isaac in Terminal 2 was also on the GPU (3577 MiB seen just before the run). |
| Wall time incl. startup + reload | 89.8 s; export of 2000 frames ~ a few s |
| Checkpoint saved | **yes**: `train/checkpoints/000300/pretrained_model/` (model.safetensors, config, pre/post-processor) |
| Checkpoint reloads | **yes**: `ACTPolicy.from_pretrained` + `make_pre_post_processors(pretrained_path=...)` + `select_action` on a dataset frame -> action shape (1, 9), finite |
| `lerobot-train` exit code | **1** (see below) |

**Windows failure in `lerobot-train` (after the checkpoint is written):**

```
File "...\lerobot\scripts\lerobot_train.py", line 703, in train
    update_last_checkpoint(checkpoint_dir)
File "...\lerobot\common\train_utils.py", line 101, in update_last_checkpoint
    last_checkpoint_dir.symlink_to(relative_target)
OSError: [WinError 1314] A required privilege is not held by the client: '000300' -> 'data\runs\t3_act_smoke_20261015_170519\train\checkpoints\last'
```

Windows only lets admins or Developer-Mode users create symlinks. Consequences: every save (`--save_freq`) kills the
run right after writing that step's checkpoint, so a long run dies at its first save. Not worked around (system
setting / human decision). Options: (a) turn on Windows Developer Mode (Settings > System > For developers), which
allows symlinks without admin; (b) run training via a small in-repo wrapper that replaces
`lerobot.common.train_utils.update_last_checkpoint` with a copy/no-op before calling `lerobot_train.train`;
(c) for short runs, set `--save_freq` = `--steps` and accept exit code 1 (what this smoke did).
