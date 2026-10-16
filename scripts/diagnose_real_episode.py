"""One real Nemotron VL diagnosis of a recorded sim episode (sprint 2, T4 Task 6).

Run:  uv run python scripts/diagnose_real_episode.py [--episode DIR] [--dry-run]

The default episode is T2's clean scripted Franka demo, C:\\dev\\pm-t2\\data\\smoke_cam,
read-only: front + wrist frames, steps.npz and signals.npz. The trajectory diagnosed is the
recorded one (measured TCP pose, gripper command, t = step / fps), because that is what
the frames show. Windows use the recorded signals; without signals.npz they use empty
contacts and a cube resting at its start pose, and the output says so.

A clean expert demo should come back "keep", or with minor issues only. Anything else
the model reports is a false positive; the rules detector runs on the same windows for
comparison.

Cost: one diagnose() call, 8 images of 128x128 (7 front + 1 wrist), plus at most one
retry if the reply is invalid, so at most 2 calls, ~$0.0013 each. It refuses to run
again once <out>/result.json exists (use --force to override), so the task's cap of
3 calls cannot be exceeded by accident. --dry-run builds every input and runs the
rules, with no call.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.ai.diagnose import DIAGNOSE_TIER, MAX_IMAGES, DiagnosisError, build_diagnosis_prompt, diagnose
from app.routers.demos import FRONT, WRIST, load_frames
from demo_pipeline.episode_io import load_episode, load_signals
from demo_pipeline.measure import compute_windows
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import Diagnosis, MetricsWindow, Pose, SimSignals, Trajectory
from demo_pipeline.success import check_success

DEFAULT_EPISODE = Path(r"C:\dev\pm-t2\data\smoke_cam")
DEFAULT_OUT = Path("data/diagnose_real_episode")
# T2's smoke scene (sim_worker/scripts/smoke_replay.py): cube at (0.5, 0), bin_pose_for(0.5, 0.3).
SMOKE_BIN_POSE = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
LOG_TIER = f"vision:{DIAGNOSE_TIER}"


@dataclass
class EpisodeInputs:
    traj: Trajectory
    windows: list[MetricsWindow]
    frames: list[tuple[float, bytes]]
    wrist: bytes | None
    task_text: str
    replay_success: bool | None  # None: no signals, so it cannot be checked
    notes: list[str] = field(default_factory=list)


def build_inputs(ep_dir: Path, bin_pose: Pose) -> EpisodeInputs:
    meta, arrays, images = load_episode(ep_dir)
    if FRONT not in meta.cameras:
        raise ValueError(f"{ep_dir} has no {FRONT} frames (cameras: {meta.cameras})")
    quat = np.asarray(arrays["ee_quat"], dtype=np.float64)
    quat /= np.linalg.norm(quat, axis=1, keepdims=True)  # stored as float32
    traj = Trajectory.from_arrays(
        np.arange(meta.n_steps) / meta.fps, arrays["ee_pos"], quat, arrays["gripper"]
    )
    notes = []
    signals = load_signals(ep_dir)
    replay_success = None
    if signals is None:
        n = meta.n_steps
        none = np.zeros(n, dtype=bool)
        cube = np.tile(np.array([0.5, 0.0, 0.025]), (n, 1))
        signals = SimSignals(cube_pos=cube, contact_gripper_cube=none, contact_arm_bin=none,
                             contact_arm_table=none, max_contact_force=np.zeros(n))
        notes.append("no signals.npz: windows use empty contacts and a cube resting at (0.5, 0, 0.025)")
    else:
        replay_success = meta.passport.verification.success if meta.passport else \
            check_success(traj, signals, bin_pose).success
    has_wrist = WRIST in meta.cameras and 1 in traj.gripper
    frames, wrist = load_frames(ep_dir, meta, images, traj.t, traj.gripper, has_wrist)
    return EpisodeInputs(traj, compute_windows(traj, signals), frames, wrist, meta.task_text, replay_success, notes)


def _vl_calls() -> list[dict]:
    from nebius_llm.usage import _log_path

    path = _log_path()
    if not path.exists():
        return []
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [e for e in entries if e.get("tier") == LOG_TIER]


def _summary(diag: Diagnosis) -> dict:
    return {
        "decision": diag.decision,
        "issues": [i.model_dump(exclude_none=True) for i in diag.issues],
        "repairs": [r.model_dump() for r in diag.repairs],
        "segments": [s.model_dump() for s in diag.segments],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--episode", type=Path, default=DEFAULT_EPISODE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--dry-run", action="store_true", help="build the inputs and run the rules; no model call")
    parser.add_argument("--force", action="store_true", help="run the model again even if result.json exists")
    args = parser.parse_args(argv)

    result_path = args.out / "result.json"
    if not args.dry_run and result_path.exists() and not args.force:
        print(f"REFUSED: {result_path} exists, so the real call already ran. Use --force to spend another.")
        return 1

    inputs = build_inputs(args.episode, SMOKE_BIN_POSE)
    replay_success = True if inputs.replay_success is None else inputs.replay_success
    if inputs.replay_success is None:
        inputs.notes.append("replay success unknown without signals; told the model it SUCCEEDED")
    print(f"episode {args.episode}: {len(inputs.traj.t)} steps, {inputs.traj.duration:.2f} s, "
          f"{len(inputs.windows)} windows, replay_success={inputs.replay_success}")
    print(f"images: {len(inputs.frames)} front at t={[round(t, 2) for t, _ in inputs.frames]}"
          f" + {'1 wrist' if inputs.wrist else 'no wrist'} (cap {MAX_IMAGES})")
    for note in inputs.notes:
        print(f"NOTE: {note}")

    rules = detect_rules(inputs.traj, inputs.windows, inputs.task_text)
    print("\nRules detector:")
    print(json.dumps(_summary(rules), indent=2))

    prompt = build_diagnosis_prompt(inputs.task_text, inputs.windows, [t for t, _ in inputs.frames],
                                    inputs.wrist is not None, replay_success)
    if args.dry_run:
        print(f"\nDRY RUN: prompt is {len(prompt)} chars; no model call made.")
        return 0

    from dotenv import load_dotenv

    from nebius_llm import TokenFactoryError

    load_dotenv()
    before = len(_vl_calls())
    diagnosis, error = None, None
    try:
        diagnosis = diagnose(inputs.frames, inputs.wrist, inputs.windows, inputs.task_text, replay_success,
                             inputs.traj.duration)
    except (DiagnosisError, TokenFactoryError) as e:
        error = f"{type(e).__name__}: {e}"
    calls = _vl_calls()[before:]
    for n, e in enumerate(calls, start=1):
        print(f"\ncall {n}: model={e['model']} prompt_tokens={e['prompt_tokens']} "
              f"completion_tokens={e['completion_tokens']} cost=${e['est_cost_usd']:.6f} "
              f"latency={e['latency_s']}s finish={e['finish_reason']}")
    cost = sum(e["est_cost_usd"] for e in calls)
    print(f"this run: {len(calls)} calls, ${cost:.6f} estimated")

    result = {
        "episode": str(args.episode),
        "replay_success": inputs.replay_success,
        "notes": inputs.notes,
        "calls": calls,
        "est_cost_usd": cost,
        "error": error,
        "nemotron": _summary(diagnosis) if diagnosis else None,
        "rules": _summary(rules),
    }
    args.out.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"wrote {result_path}")
    if error:
        print(f"\nFAILED: {error}")
        return 1
    print("\nNemotron diagnosis:")
    print(json.dumps(_summary(diagnosis), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
