"""Robot twin replay: a saved episode's joints, for the Record page's 3D twin (web/src/twin), so a visitor without a
sim can watch real, verified copies move.

    GET /twin/episodes?robot=franka&verified=true&limit=20
        Demos with a recorded episode whose joints the twin can name, newest first:
        [{id, source, robot, n_steps, fps, verified, lineage}]. verified=true keeps only those whose passport
        says the sim verified them (the multiplied copies); verified=false, those it didn't; unset, all.
    GET /twin/episodes/{id}
        {demo_id, source, robot, fps, n_steps, joint_names, joint_pos [N][J], gripper [N],
         cube_pos [N][3] | null, cube_quat [4], bin [7], base [7], verified, lineage}
        404 no such demo; 409 no recorded episode, or a robot whose joint order isn't known; 422 a corrupt episode.

Every number is the episode's own (steps.npz, signals.npz) or its demo's scene, rounded to 4 decimals. The sim
records the cube's position but not its rotation, so cube_quat is the scene's start orientation, held. Poses are
[x, y, z, qw, qx, qy, qz] in the env frame (the robot's base frame for the Franka).

The store root is DATA_DIR (demo_pipeline.paths.data_dir), read on every request.
"""
from __future__ import annotations

import zipfile
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query

from demo_pipeline.episode_io import EpisodeMeta, load_signals
from demo_pipeline.schemas import Demo
from demo_pipeline.store import DemoStore

router = APIRouter(prefix="/twin", tags=["twin"])

# The order of joint_pos in a recorded episode: Isaac Lab's articulation order, which the episode doesn't store.
# Franka: the live sink reads robot.joint_names; recorded episodes agree (each column sits inside its URDF limits,
# and the two finger columns are equal and in 0..0.04 m). Other robots: add them once read from Isaac the same way.
JOINT_NAMES: dict[str, tuple[str, ...]] = {
    "franka": (*(f"panda_joint{i}" for i in range(1, 8)), "panda_finger_joint1", "panda_finger_joint2"),
}
# The robot's root in the env frame (sim_worker/robots.py RobotSpec.base_pos).
BASES: dict[str, tuple[float, float, float]] = {"franka": (0.0, 0.0, 0.0)}
DECIMALS = 4

_CORRUPT = (ValueError, OSError, KeyError, EOFError, zipfile.BadZipFile)


def get_store() -> DemoStore:
    return DemoStore()


def _round(a) -> list:
    return (np.round(np.asarray(a, dtype=np.float64), DECIMALS) + 0.0).tolist()


def _meta(store: DemoStore, demo_id: str) -> EpisodeMeta | None:
    path = store.episode_dir(demo_id) / "episode.json"
    if not path.is_file():
        return None
    return EpisodeMeta.model_validate_json(path.read_text(encoding="utf-8"))


def _passport(store: DemoStore, demo_id: str, meta: EpisodeMeta):
    try:
        return store.get_passport(demo_id) or meta.passport
    except (ValueError, OSError):
        return meta.passport


def _summary(store: DemoStore, demo: Demo, meta: EpisodeMeta) -> dict:
    passport = _passport(store, demo.id, meta)
    return {
        "id": demo.id,
        "source": demo.source,
        "robot": meta.robot,
        "n_steps": meta.n_steps,
        "fps": meta.fps,
        "verified": None if passport is None else passport.verification.success,
        "lineage": None if passport is None else passport.lineage,
    }


@router.get("/episodes")
def list_episodes(robot: Literal["franka", "openarm", "flexiv"] | None = None, verified: bool | None = None,
                  limit: int = Query(20, ge=1, le=200), store: DemoStore = Depends(get_store)) -> list[dict]:
    out = []
    for demo in store.list_demos():
        if demo.scene.robot not in JOINT_NAMES or (robot is not None and demo.scene.robot != robot):
            continue
        try:
            meta = _meta(store, demo.id)
        except _CORRUPT:
            continue
        if meta is None:
            continue
        row = _summary(store, demo, meta)
        if verified is not None and row["verified"] is not verified:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


@router.get("/episodes/{demo_id}")
def get_episode(demo_id: str, store: DemoStore = Depends(get_store)) -> dict:
    return episode_payload(store, demo_id)


def episode_payload(store: DemoStore, demo_id: str) -> dict:
    """The twin's replay of one demo in this store (the body of GET /episodes/{id}); also the data showcase's."""
    try:
        demo = store.get_demo(demo_id)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    except ValueError as e:
        raise HTTPException(422, f"demo {demo_id!r} is corrupt: {e}") from None
    try:
        meta = _meta(store, demo_id)
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo_id!r} is corrupt: {type(e).__name__}: {e}") from None
    if meta is None:
        raise HTTPException(409, f"demo {demo_id!r} has no recorded episode")
    names = JOINT_NAMES.get(meta.robot)
    if names is None:
        raise HTTPException(409, f"the twin doesn't know the {meta.robot} episode's joint order yet")
    ep_dir = store.episode_dir(demo_id)
    try:
        with np.load(ep_dir / "steps.npz") as npz:
            joint_pos, gripper = npz["joint_pos"], npz["gripper"]
        signals = load_signals(ep_dir)
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo_id!r} is unreadable: {type(e).__name__}: {e}") from None
    if joint_pos.shape != (meta.n_steps, len(names)) or gripper.shape != (meta.n_steps,):
        raise HTTPException(422, f"episode of {demo_id!r} has joint_pos {joint_pos.shape} and gripper {gripper.shape}; "
                                 f"expected ({meta.n_steps}, {len(names)}) and ({meta.n_steps},)")
    cube = signals.cube_pos if signals is not None and signals.n_steps == meta.n_steps else None
    row = _summary(store, demo, meta)
    bin_pose, cube_pose = demo.scene.bin_pose, demo.scene.cube_pose
    return {
        "demo_id": demo.id,
        "source": demo.source,
        "robot": meta.robot,
        "fps": meta.fps,
        "n_steps": meta.n_steps,
        "joint_names": list(names),
        "joint_pos": _round(joint_pos),
        "gripper": [int(g) for g in gripper],
        "cube_pos": None if cube is None else _round(cube),
        "cube_quat": _round(cube_pose.quat_wxyz),
        "bin": _round([*bin_pose.pos, *bin_pose.quat_wxyz]),
        "base": _round([*BASES[meta.robot], 1.0, 0.0, 0.0, 0.0]),
        "verified": row["verified"],
        "lineage": row["lineage"],
    }
