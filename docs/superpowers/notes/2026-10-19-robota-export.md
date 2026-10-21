# Robota-Embed export of SANT's verified episodes (2026-10-19, branch `pm/robota-export`)

No GPU was used. This adds an exporter that writes our sim-verified episodes in the anchor format of Robota-Embed
(arXiv 2610.19495, Appendix A). Their code isn't released, so it matches the content in our own versioned layout
(`sant-robota-embed/1`).

```
uv run python -m demo_pipeline.export_robota --dataset <LeRobot dataset dir> --out <dir> [--stride-s 0.5 --horizon-s 4 --frames 16]
```

Other options: `--val-frac 0.1 --test-frac 0.1 --split-seed 0`.

## What it writes

- `anchors.jsonl`: one anchor per line.
  - The query has the instruction, a 320x192 crop, the raw and normalized action at `t`, and the source id.
  - The target has the instruction, 16 frame indices over steps `t+1 .. t+200`, and all 200 actions, raw and
    normalized.
  - Weak labels: the phase at `t`, the phase at each target frame, and the object roles.
- `crops/*.jpg`: the crop images.
- `manifest.json`: robot, action names, rates, q01/q99 statistics, parameters, split counts, and every episode
  with its split.
- `README.md`: the format in plain words.

## How

- **Code.** The pure math is in `src/demo_pipeline/robota.py`: windows, IoU dedup, splits, normalization, phases,
  projection and crop box. The file I/O is in `src/demo_pipeline/export_robota.py`.
- **Inputs.** The LeRobot parquet has only joints and actions. So the exporter follows the dataset's
  `manifest.json` to each source episode folder. There it reads `steps.npz` (actions, `ee_pos`/`ee_quat`, gripper
  command), `signals.npz` (cube track), `scene.json` (bin pose) and the front PNGs.
- **Verified only.** It keeps only episodes whose passport says `verification.success`.
- **Splits.** It splits by `human_root` before anchoring, so every multiplied copy of a demo lands in the same
  split as its source. The order is a seeded hash: with 10 sources, that's 8 / 1 / 1.
- **Normalization.** q01 maps to -1 and q99 to +1, not clipped. The statistics come from all action rows of the
  train episodes. Actions are zero-padded to 64.
- **Crops.** It projects the cube's 8 corners, the fingertip center, both finger tips and the back of the hand
  into the front camera. The camera pose and lens are copied from `sim_worker/scene_cfg.py`, and a test checks the
  copies still match. It takes a 5:3 box with a margin, shifts it inside the image, and resizes it to 320x192.
  - Checked against a render: on `home_src_3000` step 0, the projected cube lands within 1–3 px of the red pixels.
  - Our camera renders 128x128, so crops are upsampled. `crop_box_px` keeps the real box, which is 40–128 px wide.
- **Phases.**
  - reach: before the first close;
  - grasp: closed, cube within 1 cm of its rest height;
  - carry: closed, lifted;
  - place: closed, cube over the bin's inner footprint, in the bin's own yaw;
  - release: open after a close.
- **Action names.** `panda_joint1..7, panda_finger_joint1, panda_finger_joint2`, in Isaac Lab's order. The LeRobot
  `info.json` only says `joint_0..8`.

## Results (output under `data/exports/robota/`, gitignored)

| dataset | verified episodes | sources | anchors (train / val / test) | crops clipped | size |
|---|---|---|---|---|---|
| `raw_multiply_10` (sprint 6, the 10x10 set) | 110 (0 skipped) | 10 (8/1/1) | **329** (263 / 33 / 33) | 18 | 27 MB |
| `raw_multiply_10x30` (sprint 8) | 310 (0 skipped) | 10 (8/1/1) | **926** (740 / 93 / 93) | 55 | 75 MB |

- **Split for `raw_multiply_10`.** Seed 0 puts `home_src_3001` in test and `home_src_3008` in val.
- **Phase at `t`, `raw_multiply_10`, train.** reach 145, grasp 31, carry 87, place 0, release 0.
  - Anchors sit at t = 0, 2.5 and 5.0 s. The dedup needs ≥ 2.4 s between anchors, and the 4 s window must fit
    inside the ~9.6 s episodes. So no anchor starts during place or release.
  - Those phases do appear in the targets: across all 5264 target frames, carry 2023, reach 1188, place 1007,
    grasp 642, release 404.
- **Clipped crops.** They're at t = 0 and t = 5.0 s, where the hand is high above the cube. The 5:3 box at full
  image width cuts off the top of the hand. They're flagged with `crop_clipped`, not dropped.
- **Cross-check.** All 329 anchors' raw query and target actions match the LeRobot parquet (`C:\venvs\lerobot`,
  pyarrow), frame by frame. The largest difference is 5e-7, which is the 6-decimal rounding.

## Changes and checks

- Added the `pillow` dependency (`uv add pillow`, with your OK). The SANT venv had no image library to write JPGs.
- Tests: `tests/test_dp_robota.py` (19, pure) and `tests/test_dp_export_robota.py` (4, a synthetic dataset with
  one failed episode). The full suite: `uv run pytest -q` → 1529 passed, 15 skipped, 0 failed.

## Open questions

- **"Source id."** I read it as the data source or embodiment tag. It's set to `sant_isaac_franka_pick_place` and
  is a parameter of `export()`. The source demo is stored separately as `source_demo`. Check this against the
  paper if it means something else.
- **Normalization rows.** The q01/q99 statistics use every train frame, not only frames that fall inside anchor
  windows.
