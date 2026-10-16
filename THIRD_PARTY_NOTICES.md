# Third-party notices

This repository's own code is MIT-licensed (see [LICENSE](LICENSE)). It uses, and in a few
places includes, third-party software, data and services under their own terms, listed
below.

- **Included in this repo** means a copy of the third party's files is committed here.
- **Installed or downloaded** means you get it yourself (pip, npm, NVIDIA's asset servers,
  Google's CDN). Nothing of it is redistributed by this repo.

Licenses were read from the installed package metadata or the committed license files on
2026-10-16 (pre-publication audit, `docs/superpowers/notes/2026-10-16-prepublish-audit.md`).

## Included in this repo

| Component | Where | License | Notice |
|---|---|---|---|
| obra/superpowers skills: `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion` (https://github.com/obra/superpowers) | `.claude/skills/<name>/` | MIT, Copyright (c) 2025 Jesse Vincent | The full license is kept in each folder's `LICENSE`. |
| Anthropic `frontend-design` skill (https://github.com/anthropics/claude-plugins-official) | `.claude/skills/frontend-design/` | Apache-2.0 | The full license is kept in `LICENSE.txt` in that folder. |
| NVIDIA Isaac-GR00T sample `demo_data/cube_to_bowl_5/meta/modality.json` (https://github.com/NVIDIA/Isaac-GR00T, commit `dac54b3`) | `lerobot_tools/tests/data/gr00t_cube_to_bowl_5_modality.json` | Apache-2.0, Copyright NVIDIA Corporation | Verbatim test fixture. Provenance is recorded in `lerobot_tools/tests/data/README.md`. |
| Camera parameters from Isaac Lab 3.0's Franka stack visuomotor config (https://github.com/isaac-sim/IsaacLab) | `sim_worker/scene_cfg.py` (wrist camera, marked in a comment) | BSD-3-Clause, Copyright (c) 2022-2026 The Isaac Lab Project Developers | A few numeric config values. |

## Installed or downloaded (not redistributed)

### NVIDIA simulation stack (sim worker, `sim_worker/`, `sim_eval/`)

| Component | Version used | License |
|---|---|---|
| NVIDIA Isaac Sim (pip package `isaacsim`) | 6.2.0.0 | NVIDIA proprietary (Isaac Sim / Omniverse license). You install it yourself and accept NVIDIA's terms. |
| Isaac Lab (`isaaclab`, `isaaclab_assets`, `isaaclab_tasks`), branch `release/3.0.0` | 27.2.0 / 2.0.1 / 25.1.0 | BSD-3-Clause |
| Robot and scene assets: Franka Panda, OpenArm, Flexiv Rizon 4s (`isaaclab_assets` configs) | from NVIDIA's asset servers | Downloaded by Isaac Lab at runtime under NVIDIA's asset terms. **No robot USD or other asset file is committed here** (audit: no `.usd*` file exists in any commit). |

### LeRobot venv (`lerobot_tools/`)

| Component | Version used | License |
|---|---|---|
| LeRobot (`lerobot[dataset,training]`) | 0.6.1 | Apache-2.0 |
| PyTorch / torchvision (CUDA 12.8 build) | 2.11.0 / 0.26.0 | BSD-3-Clause / BSD |
| PyAV (`av`) | 15.1.0 | BSD-3-Clause (bundles FFmpeg, LGPL/GPL depending on build) |
| Hugging Face `datasets`, `huggingface-hub` | 4.8.5 / 1.33.0 | Apache-2.0 |
| Pillow | 12.3.0 | MIT-CMU (HPND) |

### Backend and pipeline (SANT venv, `pyproject.toml`, top-level dependencies)

| Component | Version used | License |
|---|---|---|
| openai (Python SDK, used as the Token Factory client) | 3.13.0 | Apache-2.0 |
| fastapi / starlette | 0.141.1 / 1.6.0 | MIT / BSD-3-Clause |
| uvicorn[standard] (incl. websockets) | 0.53.0 | BSD-3-Clause |
| sqlalchemy | 2.0.54 | MIT |
| pydantic | 2.13.5 | MIT |
| numpy | 2.5.4 | BSD-3-Clause (plus 0BSD, MIT, Zlib for bundled parts) |
| httpx | 0.28.1 | BSD-3-Clause |
| python-dotenv | 1.2.3 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| pytest (dev) | 9.1.1 | MIT |
| hatchling (build backend) | | MIT |

Transitive dependencies are pinned in `uv.lock`.

### Web app (`web/package.json`, top-level dependencies)

| Component | Version used | License |
|---|---|---|
| @mediapipe/tasks-vision | 0.10.17 | Apache-2.0 |
| MediaPipe `hand_landmarker.task` model (float16/1, from `storage.googleapis.com/mediapipe-models/...`) and the tasks-vision WASM files | | Apache-2.0 (Google). Copied into `web/public/models/` and `web/public/mediapipe/` locally; **both paths are git-ignored and were never committed**. |
| react / react-dom | 18.3.1 | MIT |
| react-router-dom | 6.30.6 | MIT |
| three | 0.169.0 | MIT |
| @react-three/fiber / @react-three/drei | 8.18.0 / 9.122.0 | MIT |
| animejs | 4.5.0 | MIT |
| lenis | 1.3.26 | MIT |
| Dev: vite, vitest, @vitejs/plugin-react, jsdom, @testing-library/react, @testing-library/jest-dom, @types/* | see `web/package-lock.json` | MIT |
| Dev: typescript | 5.9.3 | Apache-2.0 |
| Fonts: Instrument Serif, JetBrains Mono (loaded from Google Fonts at runtime by `web/src/three/fonts.ts`) | | SIL Open Font License 1.1 |

Transitive dependencies are pinned in `web/package-lock.json`.

## Models and services used over an API

| Service / model | How it is used | Terms |
|---|---|---|
| **NVIDIA Nemotron 3.5 Super VL** (`nvidia/Nemotron-3.5-Super-VL`), plus the SANT-era Nemotron text tiers in `src/nebius_llm/config.py` | Called at runtime through Nebius Token Factory's API. **No model weights are downloaded or redistributed.** | Use through the API is governed by the Nebius Token Factory terms of service and NVIDIA's model license for each model (NVIDIA publishes these on the model's NGC / Hugging Face card). The exact license name for Nemotron 3.5 Super VL was not confirmed during the audit; check its model card before quoting it. |
| **Nebius Token Factory** (`https://api.tokenfactory.nebius.com/v1/`) | OpenAI-compatible inference API | Nebius terms of service. Your API key goes in `.env`, which is git-ignored. |
| reali3 (`src/app/ai/reali3.py`, SANT-era, optional) | Photogrammetry API, only if `REALI3_API_KEY` is set | reali3 terms of service. Not part of the submission pipeline. |

## Trademarks

NVIDIA, Isaac Sim, Isaac Lab, Omniverse and Nemotron are trademarks of NVIDIA Corporation.
Nebius and Token Factory are trademarks of Nebius. Franka is a trademark of Franka Robotics.
They are used here only to name the software and services this project uses; this project is
not endorsed by them.
