"""The practice-and-correct loop (research note 2026-10-20, section (d); IWR / RaC): run the policy on practice scenes,
find where each rollout went wrong, rewind about 1 s, and let someone finish the task from there. Pure: no Isaac.

1. Practice rollouts are traced (sim_eval run_eval --trace: every control step's joints, tool, cube and contacts,
   so any step is a checkpoint recovery.py can restore).
2. failure_moments(trace, scene): the first of each kind, from the same signals the verdict uses:
   - failed_grasp: a close that hasn't caught the cube 0.5 s later (still closed and holding it);
   - high_close: such a close with the tool > 15 mm above the cube centre and no lift within 0.5 s;
   - drop: the fingers lose the cube with the gripper still closed, off the bin (check_success's "dropped");
   - rim_hit: the arm on the bin above COLLISION_FORCE_N (5 N);
   - empty_at_bin: closing or opening within 15 cm of the bin's footprint with no cube in the fingers.
3. correction_candidates(): the state REWIND_S before each failure, or further back (up to MAX_BACK_S) until it can
   be restored faithfully (recovery._restorer: cube flat, still and on the table, hand slow). A failure with no such
   state (e.g. the cube in the hand all along) is skipped with the reason; two failures that land on the same state
   give one candidate.
4. The retake: the scripted expert's continuation (recovery.recovery_trajectory, replayed and verified with the
   unchanged check by recovery.run_recovery, lineage "recovery-<policy>"), or a human "retake from here" queued in
   DATA_DIR/corrections/queue/<name>.json for the Record page to open later.
5. corrections_grid(): the base cell plus every verified correction, as one cell "corrections_<k>";
   provenance_rows() ties each to its failure, rewind, rollout and verdict.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict

from demo_pipeline.schemas import Scene
from demo_pipeline.store import write_atomic
from demo_pipeline.success import COLLISION_FORCE_N

from .recovery import RECOVERY_ROOT_PREFIX, RecoveryState, _restorer, state_at

FAILURE_KINDS = ("failed_grasp", "high_close", "drop", "rim_hit", "empty_at_bin")
REWIND_S = 1.0
MAX_BACK_S = 3.0
CATCH_S = 0.5  # a close has caught the cube if it still holds it this long after
HIGH_CLOSE_M = 0.015  # the tool this far above the cube centre at a close
LIFT_M = 0.01  # the cube rising this much within CATCH_S is a lift
NEAR_BIN_M = 0.15  # from the bin's outer footprint
BIN_FOOT_HALF = 0.11  # the bin's outer half width (BIN_INNER 0.20 / 2 + BIN_WALL)
BIN_INNER_HALF = 0.10


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FailureMoment(_Model):
    kind: Literal["failed_grasp", "high_close", "drop", "rim_hit", "empty_at_bin"]
    k: int  # the trace step
    t: float  # s
    detail: str = ""


class CorrectionCandidate(_Model):
    moment: FailureMoment
    state: RecoveryState | None  # where the retake starts; None when skipped
    skipped: str | None = None


def _bin_frame(xy: np.ndarray, scene: Scene) -> np.ndarray:
    w, x, y, z = scene.bin_pose.quat_wxyz
    yaw = np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    c, s = np.cos(-yaw), np.sin(-yaw)
    d = np.asarray(xy, dtype=float) - np.asarray(scene.bin_pose.pos[:2])
    return np.stack([c * d[..., 0] - s * d[..., 1], s * d[..., 0] + c * d[..., 1]], axis=-1)


def _to_footprint(xy: np.ndarray, scene: Scene) -> np.ndarray:
    """Horizontal distance from points to the bin's outer footprint (0 inside it)."""
    local = np.abs(_bin_frame(xy, scene))
    gap = np.maximum(local - BIN_FOOT_HALF, 0.0)
    return np.linalg.norm(gap, axis=-1)


def failure_moments(trace: dict, scene: Scene, fps: int = 50) -> list[FailureMoment]:
    """The first moment of each failure kind in a traced rollout, in time order."""
    tcp, cube = np.asarray(trace["tcp_pos"], dtype=float), np.asarray(trace["cube_pos"], dtype=float)
    grip = np.asarray(trace["gripper"]).astype(int)
    held = np.asarray(trace["contact_gripper_cube"]).astype(bool)
    arm_bin = np.asarray(trace["contact_arm_bin"]).astype(bool)
    force = np.asarray(trace["max_contact_force"], dtype=float)
    n = len(grip)
    window = max(1, round(CATCH_S * fps))
    near_bin = _to_footprint(tcp[:, :2], scene) <= NEAR_BIN_M
    cube_over_bin = np.all(np.abs(_bin_frame(cube[:, :2], scene)) <= BIN_INNER_HALF, axis=1)
    found: dict[str, FailureMoment] = {}

    def add(kind: str, k: int, detail: str) -> None:
        if kind not in found:
            found[kind] = FailureMoment(kind=kind, k=int(k), t=round(k / fps, 3), detail=detail)

    for k in np.flatnonzero((grip[:-1] == 0) & (grip[1:] == 1)) + 1:
        end = min(k + window, n - 1)
        if grip[end] == 1 and held[max(k, end - 4):end + 1].any():
            continue  # caught
        above = tcp[k, 2] - cube[k, 2]
        lifted = cube[k:end + 1, 2].max() - cube[k, 2] > LIFT_M
        if near_bin[k] and not held[k]:
            add("empty_at_bin", k, f"closed {_to_footprint(tcp[k, :2], scene) * 100:.0f} cm from the bin with nothing held")
        elif above > HIGH_CLOSE_M and not lifted:
            add("high_close", k, f"closed {above * 1000:.0f} mm above the cube centre, no lift")
        else:
            add("failed_grasp", k, f"closed {np.linalg.norm(tcp[k, :2] - cube[k, :2]) * 1000:.0f} mm off the cube, "
                                   "not holding it 0.5 s later")
    for k in np.flatnonzero((grip[:-1] == 1) & (grip[1:] == 0)) + 1:
        if near_bin[k] and not held[k - 1]:
            add("empty_at_bin", k, f"opened {_to_footprint(tcp[k, :2], scene) * 100:.0f} cm from the bin with nothing held")
    for k in np.flatnonzero(held[:-1] & ~held[1:] & (grip[1:] == 1)) + 1:
        if not cube_over_bin[k]:
            add("drop", k, "the fingers lost the cube on the way, off the bin")
            break
    hits = np.flatnonzero(arm_bin & (force > COLLISION_FORCE_N))
    if hits.size:
        k = int(hits[0])
        add("rim_hit", k, f"the arm pushed {force[k]:.0f} N on the bin")
    return sorted(found.values(), key=lambda m: (m.k, FAILURE_KINDS.index(m.kind)))


def correction_candidates(trace: dict, scene: Scene, *, source: str, rewind_s: float = REWIND_S,
                          max_back_s: float = MAX_BACK_S, fps: int = 50) -> list[CorrectionCandidate]:
    """One candidate per failure moment: the restorable state rewind_s before it (or further back, to max_back_s)."""
    restorable = _restorer(trace, scene, fps)
    out: list[CorrectionCandidate] = []
    taken: dict[int, str] = {}
    for m in failure_moments(trace, scene, fps):
        start = min(m.k - round(rewind_s * fps), m.k - 1)
        stop = max(m.k - round(max_back_s * fps), 0)
        k = next((j for j in range(start, stop - 1, -1) if restorable(j, "rewind")), None)
        name = f"corr_{scene.seed}_{m.kind}"
        if k is None:
            out.append(CorrectionCandidate(moment=m, state=None, skipped=(
                f"no restorable state from {rewind_s:.1f} s to {max_back_s:.1f} s before the {m.kind} "
                "(the cube in the hand, moving or in the bin, or the hand too fast)")))
        elif k in taken:
            out.append(CorrectionCandidate(moment=m, state=None, skipped=f"same state as {taken[k]}"))
        else:
            taken[k] = name
            out.append(CorrectionCandidate(moment=m, state=state_at(trace, scene, k, name=name, mode=f"rewind_{m.kind}",
                                                                     source=source, fps=fps)))
    return out


# --- the human retake queue ---------------------------------------------------------------------------------------

QUEUE_DIR = ("corrections", "queue")
_SAFE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,80}$")


class RetakeItem(_Model):
    """A "retake from here" for a person on the Record page: the restored state, its scene, why, and where from."""

    name: str
    round_id: str
    seed: int
    source: str  # the policy cell whose rollout failed
    checkpoint: str
    trace: str
    failure: FailureMoment
    state: RecoveryState
    scene: Scene
    status: Literal["open", "done", "skipped"] = "open"
    demo_id: str | None = None  # the human demo that retook it
    created_at: str


def retake_item(cand: CorrectionCandidate, scene: Scene, *, checkpoint: str, trace_path: str, round_id: str) -> RetakeItem:
    if cand.state is None:
        raise ValueError(f"the {cand.moment.kind} candidate was skipped: {cand.skipped}")
    st = cand.state
    return RetakeItem(name=st.name, round_id=round_id, seed=st.seed, source=st.source, checkpoint=str(checkpoint),
                      trace=str(trace_path), failure=cand.moment, state=st, scene=scene,
                      created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))


class RetakeQueue:
    def __init__(self, root: Path) -> None:
        self.dir = Path(root).joinpath(*QUEUE_DIR)

    def _path(self, name: str) -> Path:
        if not isinstance(name, str) or not _SAFE.match(name):
            raise KeyError(name)
        return self.dir / f"{name}.json"

    def add(self, item: RetakeItem) -> bool:
        """Queue it; False if that state is queued already (never overwritten)."""
        path = self._path(item.name)
        if path.exists():
            return False
        write_atomic(path, item.model_dump_json(indent=1))
        return True

    def get(self, name: str) -> RetakeItem:
        path = self._path(name)
        if not path.is_file():
            raise KeyError(name)
        return RetakeItem.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self, status: str | None = None) -> list[RetakeItem]:
        items = []
        if self.dir.is_dir():
            for p in sorted(self.dir.glob("*.json")):
                try:
                    item = self.get(p.stem)
                except (KeyError, ValueError):
                    continue
                if status is None or item.status == status:
                    items.append(item)
        return sorted(items, key=lambda i: (i.created_at, i.name))

    def mark(self, name: str, status: Literal["open", "done", "skipped"], demo_id: str | None = None) -> RetakeItem:
        item = self.get(name).model_copy(update={"status": status, "demo_id": demo_id})
        write_atomic(self._path(name), item.model_dump_json(indent=1))
        return item


# --- the corrections cell and its provenance ----------------------------------------------------------------------

def corrections_grid(base_grid: dict, rows: list[dict], *, name: str, min_corrections: int = 10,
                     label: str | None = None, cell_label: str | None = None) -> dict:
    """The base grid's cell (the one labelled cell_label, or its only one) plus every verified correction episode, as
    cell "corrections_<k>" (same condition and n_human: corrections are recovery copies, which assemble keeps out of
    n_human)."""
    cells = base_grid["cells"]
    if cell_label is not None:
        cells = [c for c in cells if (c.get("label") or f"{c['condition']}_{c['n_human']}") == cell_label]
    if len(cells) != 1:
        raise ValueError(f"the base grid needs exactly one cell{f' labelled {cell_label!r}' if cell_label else ''}")
    (cell,) = cells
    verified = [r["ep_dir"] for r in rows if r.get("success") and r.get("ep_dir")]
    if len(verified) < min_corrections:
        raise ValueError(f"only {len(verified)} verified corrections (the cell needs >= {min_corrections})")
    return {"name": name, "cells": [{"condition": cell["condition"], "n_human": cell["n_human"],
                                     "label": label or f"corrections_{len(verified)}",
                                     "episode_dirs": list(cell["episode_dirs"]) + verified}]}


def provenance_rows(rows: list[dict], candidates: list[CorrectionCandidate], *, checkpoint: str, traces_dir: str,
                    round_id: str, retake: str = "scripted") -> list[dict]:
    """Per replayed correction: its failure, the rewind, the rollout it came from, the verdict."""
    by_name = {c.state.name: c for c in candidates if c.state is not None}
    out = []
    for r in rows:
        c = by_name.get(r["name"])
        if c is None:
            continue
        st, m = c.state, c.moment
        out.append({
            "name": r["name"], "ep_dir": r.get("ep_dir"), "round": round_id, "retake": retake,
            "lineage_root": RECOVERY_ROOT_PREFIX + st.source,
            "failure": {"kind": m.kind, "k": m.k, "t": m.t, "detail": m.detail},
            "rewind": {"k": st.k, "t": round(st.t, 3), "back_s": round(m.t - st.t, 3)},
            "rollout": {"seed": st.seed, "trace": Path(traces_dir, f"seed_{st.seed}.npz").as_posix(),
                        "checkpoint": str(checkpoint)},
            "verified": bool(r.get("success")), "reasons": list(r.get("reasons", [])),
        })
    return out
