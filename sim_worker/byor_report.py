"""The "Bring your robot" report card, minus the sim: drive gains, the reach map, joint-limit hits, the verdict and the
report JSON (docs/design/byor-api.md section 6). numpy only; sim_worker/scripts/robot_report.py runs the sim part
and calls these. Every number in the report carries a `source`.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np

from demo_pipeline.multiply import SCENE_RANGES

from .robots import RobotSpec, hand_from_tool
from .urdf_import import Roles, Urdf
from .urdf_kin import POS_TOL, ROT_TOL, Chain, quat_to_matrix

SCHEMA = "sant.robot_report/1"
TASK_TEXT = "pick up the red cube and place it in the blue bin"
WORKSPACE_ROBOT = "franka"  # every robot is graded on the Franka's scenes (spec 8.6)
WORKSPACE = SCENE_RANGES[WORKSPACE_ROBOT]

# Drive gains for every uploaded robot: Isaac Lab's FRANKA_PANDA_HIGH_PD_CFG (the stiff PD it recommends for
# differential IK) on the arm, its legacy hand gains on the driven fingers; mimic fingers get no drive.
ARM_STIFFNESS, ARM_DAMPING = 400.0, 80.0
GRIPPER_STIFFNESS, GRIPPER_DAMPING = 2e3, 1e2
GAINS_SOURCE = ("arm: stiffness 400, damping 80 (Isaac Lab FRANKA_PANDA_HIGH_PD_CFG); driven gripper joints: 2000 / "
                "100 (its hand); mimic joints: no drive; effort and velocity limits from the URDF; gravity off on "
                "the robot, as in the *_HIGH_PD configs")

GRID_X = tuple(round(0.40 + 0.05 * i, 2) for i in range(6))  # 0.40 .. 0.65: the cube and bin x ranges
GRID_Y = tuple(round(-0.30 + 0.05 * i, 2) for i in range(13))  # -0.30 .. 0.30
CUBE_Z = 0.025
RELEASE_Z = 0.10  # scripted.RELEASE_ABOVE_FLOOR over a bin floor at z 0
CARRY_Z = 0.25  # scripted.LIFT_Z
LAYERS = (("grasp", CUBE_Z, 0), ("grasp", CUBE_Z, 45), ("grasp", CUBE_Z, -45), ("release", RELEASE_Z, 0),
          ("carry", CARRY_Z, 0))
REVOLUTE_TOL, PRISMATIC_TOL = 0.01, 0.0005  # rad, m: "at the limit"
READY_SHARE, PARTIAL_SHARE = 24 / 30, 6 / 30


def actuator_groups(u: Urdf, spec: RobotSpec, arm_joints: list[str]) -> dict[str, dict]:
    """name -> {joints, stiffness, damping, effort, velocity}; effort/velocity are {joint: value} from the URDF
    (None where the URDF gives none). Groups with no joints are left out."""

    def group(joints, stiffness, damping):
        eff = {j: u.joints[j].limits.effort for j in joints if u.joints[j].limits and u.joints[j].limits.effort}
        vel = {j: u.joints[j].limits.velocity for j in joints if u.joints[j].limits and u.joints[j].limits.velocity}
        return {"joints": list(joints), "stiffness": stiffness, "damping": damping, "effort": eff or None,
                "velocity": vel or None}

    out = {"arm": group(arm_joints, ARM_STIFFNESS, ARM_DAMPING),
           "gripper": group(spec.finger_joints, GRIPPER_STIFFNESS, GRIPPER_DAMPING),
           "gripper_passive": group(spec.passive_finger_joints, 0.0, 0.0)}
    return {k: v for k, v in out.items() if v["joints"]}


# --- reach map ---------------------------------------------------------------------------------------------------

def down_with_yaw(yaw: float) -> np.ndarray:
    """The tool pointing down, turned `yaw` about world z (scripted expert's grasp orientation), wxyz."""
    return np.array([0.0, math.cos(yaw / 2), math.sin(yaw / 2), 0.0])


def _arm_q(spec: RobotSpec, chain: Chain) -> np.ndarray:
    start = spec.init_joint_pos or {}
    return chain.clip(np.array([start.get(j, 0.0) for j in chain.names], dtype=float))


def reach_map(u: Urdf, spec: RobotSpec, roles: Roles) -> dict:
    """Which grid cells the tool reaches, pointing down, in each of LAYERS (joint limits enforced)."""
    chain = Chain(u, u.root, spec.hand_body, list(roles.arm_joints))
    mount = np.asarray(spec.base_pos, dtype=float)
    start = _arm_q(spec, chain)
    layers, all_ok = [], np.ones((len(GRID_X), len(GRID_Y)), dtype=bool)
    for name, z, yaw_deg in LAYERS:
        quat = down_with_yaw(math.radians(yaw_deg))
        ok = np.zeros_like(all_ok)
        prev = start
        for i, x in enumerate(GRID_X):
            for j, y in enumerate(GRID_Y):
                pos, q = hand_from_tool(spec, np.array([x, y, z]) - mount, quat)
                target = np.eye(4)
                target[:3, :3], target[:3, 3] = quat_to_matrix(q), pos
                sol = chain.solve_best(target, chain.seeds(extra=(start, prev)))
                ok[i, j] = sol.ok
                if sol.ok:
                    prev = sol.q
        all_ok &= ok
        layers.append({"name": name, "z": z, "yaw_deg": yaw_deg, "reachable": ok.tolist(),
                       "fraction": round(float(ok.mean()), 3)})
    return {
        "fraction": {"value": round(float(all_ok.mean()), 3), "source": "share of grid cells reachable in every layer"},
        "grid": {"x": list(GRID_X), "y": list(GRID_Y)},
        "layers": layers,
        "source": (f"sim_worker.urdf_kin.solve_best on the URDF chain {roles.base} -> {spec.hand_body} (the one Isaac "
                   f"imports), mount at {list(spec.base_pos)}: tool pointing down at each cell, joint limits enforced, "
                   f"from 4 start poses (the start pose, the previous cell's solution, the middle of each range, "
                   f"one random); reachable = within {POS_TOL * 1000:g} mm and {ROT_TOL:g} rad"),
    }


# --- joint limits ------------------------------------------------------------------------------------------------

def joint_limit_hits(u: Urdf, arm_joints: list[str], joint_names: list[str],
                     scenes: list[np.ndarray]) -> list[dict]:
    """Per arm joint and side: in how many scenes and steps the recorded joint position was at its URDF limit."""
    out = []
    for name in arm_joints:
        j = u.joints[name]
        if j.limits is None or j.type == "continuous" or name not in joint_names:
            continue
        col = joint_names.index(name)
        tol = PRISMATIC_TOL if j.type == "prismatic" else REVOLUTE_TOL
        for side, value in (("lower", j.limits.lower), ("upper", j.limits.upper)):
            per_scene = [int(np.sum(np.abs(np.asarray(q)[:, col] - value) <= tol)) for q in scenes if len(q)]
            if sum(per_scene):
                out.append({"joint": name, "limit": side, "value": value,
                            "scenes": sum(1 for n in per_scene if n), "steps": sum(per_scene)})
    return out


# --- the card ----------------------------------------------------------------------------------------------------

def verdict(successes: int, n: int) -> dict:
    share = successes / n if n else 0.0
    value = "ready" if share >= READY_SHARE - 1e-9 else "partial" if share >= PARTIAL_SHARE - 1e-9 else "not_ready"
    return {"value": value, "source": "rule: ready if pick-place succeeds in >= 24 of 30 scenes (80%), partial if "
                                      ">= 6 (20%), else not_ready"}


def pick_place_summary(rows: list[dict]) -> dict:
    n = len(rows)
    ok = sum(bool(r["success"]) for r in rows)
    reasons = Counter(c for r in rows if not r["success"] for c in r["reasons"])
    steps = sum(r.get("n_steps") or 0 for r in rows if r.get("tracking_mean_mm") is not None)
    mean = (sum(r["tracking_mean_mm"] * r["n_steps"] for r in rows if r.get("tracking_mean_mm") is not None) / steps
            if steps else None)
    return {
        "successes": {"value": ok, "of": n,
                      "source": "scripted expert (sim_worker.scripted) on the base scene, moved into each scene by "
                                "demo_pipeline.multiply.transform_trajectory, replayed by sim_worker.replay "
                                "(differential IK, Isaac Lab 3.0 PhysX), judged by demo_pipeline.success.check_success"},
        "failure_reasons": {"value": dict(sorted(reasons.items())),
                            "source": "demo_pipeline.success.check_success reason codes over the failed scenes; one "
                                      "scene can have several"},
        "tracking_mean_mm": {"value": None if mean is None else round(mean, 2),
                             "source": "sim_worker.tracking.tracking_stats: commanded vs reached tool point, mean over "
                                       "every step of every scene"},
    }


def build_report(*, robot: dict, roles: dict, spec: dict, seeds: tuple[int, int], rows: list[dict], reach: dict,
                 limit_hits: list[dict], provenance: dict) -> dict:
    pp = pick_place_summary(rows)
    w = WORKSPACE
    return {
        "schema": SCHEMA,
        "robot": robot,
        "roles": roles,
        "spec": spec,
        "task": {
            "name": "pick-place",
            "text": TASK_TEXT,
            "workspace": {"cube_x": list(w.cube_x), "cube_y": list(w.cube_y), "cube_yaw": list(w.cube_yaw),
                          "bin_x": list(w.bin_x), "bin_y": list(w.bin_y)},
            "seeds": list(seeds),
            "source": f"demo_pipeline.multiply.SCENE_RANGES['{WORKSPACE_ROBOT}'] (spec 8.6); scenes from "
                      "demo_pipeline.multiply.sample_scene",
        },
        "verdict": verdict(pp["successes"]["value"], pp["successes"]["of"]),
        "pick_place": pp,
        "reach_map": reach,
        "joint_limit_hits": {
            "value": limit_hits,
            "source": f"recorded joint positions (run/var_*/steps.npz joint_pos) within {REVOLUTE_TOL} rad "
                      f"(prismatic: {PRISMATIC_TOL * 1000:g} mm) of a URDF limit, over all scenes; arm joints only",
        },
        "scenes": {
            "source": "one row per seed: success and reasons from check_success, positions from sample_scene, "
                      "tracking from tracking_stats, limit hits as above",
            "rows": rows,
        },
        "provenance": provenance,
    }

