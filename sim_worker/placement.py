"""Public scene placement: put a demo_pipeline Scene (or a ScenePlan's layout, plan_layout.py) into an Isaac Lab
InteractiveScene built by scene_cfg (or plan_scene).

Shared by replay (sim_worker.replay) and policy evaluation (sim_eval), so both start from exactly the same state.
Isaac Lab 3.0 quaternions are (x, y, z, w); the Scene is (w, x, y, z).
"""

from __future__ import annotations

import numpy as np
import torch

from demo_pipeline.schemas import Scene

from .scene_cfg import BIN_PARTS, FRONT_EYE, FRONT_TARGET


def xyzw(q_wxyz) -> list[float]:
    w, x, y, z = q_wxyz
    return [x, y, z, w]


def yaw_rotate(q_wxyz, v) -> np.ndarray:
    """Rotate v by the (w, x, y, z) quaternion."""
    w, x, y, z = q_wxyz
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return rot @ np.asarray(v, dtype=float)


def place_scene(sim_scene, scene: Scene, *, aim_front_camera: bool, joint_pos=None) -> None:
    """Robot to its default joint pose (or `joint_pos`, all joints, e.g. a recovery state) at rest, cube and the 5 bin
    parts at the Scene's poses (env frame), then sim_scene.reset(); optionally aim the "front" camera. Does not step
    physics."""
    bp = scene.bin_pose
    poses = [("cube", scene.cube_pose.pos, scene.cube_pose.quat_wxyz)]
    poses += [(name, np.asarray(bp.pos) + yaw_rotate(bp.quat_wxyz, center), bp.quat_wxyz) for name, (_size, center) in BIN_PARTS.items()]
    place_bodies(sim_scene, poses, aim_front_camera=aim_front_camera, joint_pos=joint_pos)


def place_layout(sim_scene, layout, *, aim_front_camera: bool, joint_pos=None) -> None:
    """place_scene for a ScenePlan's layout (plan_layout.SceneLayout): every cube and every bin's boxes."""
    place_bodies(sim_scene, [(b.name, b.pos, b.quat_wxyz) for b in layout.bodies], aim_front_camera=aim_front_camera,
                 joint_pos=joint_pos)


def place_bodies(sim_scene, poses, *, aim_front_camera: bool, joint_pos=None) -> None:
    """Robot to its default joint pose (or `joint_pos`) at rest, each (scene name, position, wxyz) body at its pose
    (env frame), then sim_scene.reset(); optionally aim the "front" camera. Does not step physics."""
    robot = sim_scene["robot"]
    dev = sim_scene.env_origins.device
    origin = sim_scene.env_origins[0].cpu().numpy()
    if joint_pos is None:
        q = robot.data.default_joint_pos.torch.clone()
    else:
        q = torch.tensor(np.asarray(joint_pos, dtype=np.float32).reshape(1, -1), device=dev)
        if q.shape != (1, robot.num_joints) or not torch.isfinite(q).all():
            raise ValueError(f"joint_pos: expected {robot.num_joints} finite values, got {tuple(q.shape)}")
    robot.write_joint_position_to_sim_index(position=q)
    robot.write_joint_velocity_to_sim_index(velocity=robot.data.default_joint_vel.torch.clone())

    def put(name: str, pos, quat_wxyz) -> None:
        pose = torch.tensor([[*(np.asarray(pos) + origin), *xyzw(quat_wxyz)]], dtype=torch.float32, device=dev)
        sim_scene[name].write_root_pose_to_sim_index(root_pose=pose)
        sim_scene[name].write_root_velocity_to_sim_index(root_velocity=torch.zeros(1, 6, device=dev))

    for name, pos, quat_wxyz in poses:
        put(name, pos, quat_wxyz)
    sim_scene.reset()
    if aim_front_camera:
        eye = torch.tensor([np.asarray(FRONT_EYE) + origin], dtype=torch.float32, device=dev)
        target = torch.tensor([np.asarray(FRONT_TARGET) + origin], dtype=torch.float32, device=dev)
        sim_scene["front"].set_world_poses_from_view(eye, target)
