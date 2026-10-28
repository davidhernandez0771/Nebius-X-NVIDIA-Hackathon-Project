"""IsaacTeleopDriver: the TeleopDriver (sim_worker.teleop_session) on Isaac Lab.

It drives the same scene and the same control as sim_worker.replay: scene placement through
sim_worker.placement.place_scene, and differential IK with joint-velocity feedforward through
replay's step helpers. Those helpers are imported, not copied; they are module-private in
replay.py (T2's file), so a rename there breaks this module loudly at import.

Feedforward differs in one way. Replay knows the next pose, so it feeds forward the twist from
this command to the next. Teleop only knows the past, so it feeds forward the twist from the
previous command to this one: the hand's own velocity, one control step late. A jump (the first
hand after a reset, or tracking regained far away) is not fed forward: above MAX_FF_STEP_M per
step, the IK position target alone moves the arm.

Rendering: SimulationContext.step() renders after every physics step, so each control step renders the window's
viewport and both recording cameras DECIMATION times. The driver steps through SubstepSim
(sim_worker.teleop_render) with one of these modes:
  - "legacy": every render as the sim does it on its own;
  - "fast": while not recording (set_recording, called by the session), the front and wrist cameras' render
    products are paused and the viewport renders once per control step, after its last physics step. While
    recording, everything renders after every physics step as in legacy. Recorded frames then differ from
    legacy's only as legacy's differ between two takes that idle for different times before Record (the path
    tracer's per-frame sampling follows the camera's frame count; mean 0.6-0.7 levels, 0.1-0.3% of pixels > 20).
    When a recording starts the cameras resume and render RESUME_WARMUP_RENDERS frames (no physics) before the
    first recorded step. Kit's main-loop rate limit (120 Hz) is turned off (that alone leaves recorded frames bit-identical);
  - "fastest": fast, and also one render per control step while recording. The cameras then render half as
    many frames per recorded step, so recorded frames differ from legacy's by somewhat more (mean 0.7-0.9
    levels, 0.3-0.4% of pixels > 20) and possibly systematically (sharper or softer edges): an option for the
    lead to decide on, not a default.
Physics is the same in every mode. read_state() returns frames only while the cameras run. (Turning the
viewport off for the first physics step's render, to keep camera frames as in legacy while drawing the window
once, measured 130 ms per toggle pair: not used.) With a Sections (sim_worker.teleop_trace), apply() and
read_state() time their parts (ik, physics, render, read) for the sink's latency trace, with a CUDA sync before
each timer stops.

The caller must already be inside isaaclab.app.launch_simulation(make_sim_cfg(...), args).
Isaac Lab 3.0 quaternions are (x, y, z, w); everything here that crosses into demo_pipeline is (w, x, y, z).
"""

from __future__ import annotations

import dataclasses
from contextlib import nullcontext

import numpy as np
import torch

from demo_pipeline.scene_library import STANDARD_SCENE
from demo_pipeline.scene_plan import ScenePlan
from demo_pipeline.schemas import Pose, Scene

from . import replay as _replay
from .replay import CAMERA_WARMUP_STEPS, CONTACT_N, PHYSICS_DT
from .plan_layout import SceneLayout, body_key, layout_for_plan, layout_for_scene
from .plan_scene import read_cube_poses
from .scene_cfg import ARM_CONTACT_SENSORS
from .settle import SETTLE_S, settle_errors
from .teleop_render import SubstepSim
from .teleop_session import TELEOP_DT, ContactReading, StepState, TwinState, peak_contact
from .teleop_trace import Sections
from .tracking import CONTROL_DT

if TELEOP_DT != CONTROL_DT:
    raise RuntimeError(f"teleop_session.TELEOP_DT {TELEOP_DT} != tracking.CONTROL_DT {CONTROL_DT}")

SETTLE_STEPS = CAMERA_WARMUP_STEPS  # control steps holding the default joint pose after a reset
RENDER_MODES = ("legacy", "fast", "fastest")
# Renders (no physics) when paused cameras resume for a recording, ~0.25 s once. Measured against legacy on the
# fake-hand smoke: with 5 the first recorded frames differed by 1.5 mean levels (steady state 0.7, which is what
# legacy itself varies by when the person waits one second longer before Record); with 20, 0.9.
RESUME_WARMUP_RENDERS = 20
MAX_FF_STEP_M = 0.02  # 1 m/s at 50 Hz; a hand moves ~0.3 m/s, so anything faster is a jump


class IsaacTeleopDriver:
    def __init__(self, *, record_cameras: bool, robot: str = "franka", vel_ff: bool = True,
                 render: str = "legacy", sections: Sections | None = None, plan: ScenePlan | None = None) -> None:
        if render not in RENDER_MODES:
            raise ValueError(f"render must be one of {RENDER_MODES}, got {render!r}")
        # plan: build its cubes and bins (replay's plan scene, one per process) instead of today's cube and bin.
        # Without one every name below is today's ("cube", "cube_contact", scene_cfg.ARM_CONTACT_SENSORS).
        self.s = _replay._session(record_cameras, robot, plan=plan)
        self.plan = plan
        self.layout: SceneLayout | None = layout_for_plan(plan) if plan is not None else None
        self._names_from(self.layout, plan)
        self.record_cameras = record_cameras
        self.render = render
        self.vel_ff = vel_ff
        self.sections = sections
        sync = torch.cuda.synchronize if sections is not None and str(self.s.sim.device).startswith("cuda") else None
        self._sync = sync
        if render != "legacy":
            import carb

            carb.settings.get_settings().set_bool("/app/runLoops/main/rateLimitEnabled", False)
        # replay's step helpers, stepping through SubstepSim (render cadence, timing)
        self._stepper = dataclasses.replace(self.s, sim=SubstepSim(
            self.s.sim, substeps=_replay.DECIMATION, render_every=1, sections=sections, sync=sync))
        self._cameras_on = record_cameras
        self._prev_cmd: torch.Tensor | None = None
        self._prev_pos: np.ndarray | None = None
        self._action: torch.Tensor | None = None
        if render != "legacy":
            self._set_cameras(False)

    def _set_cameras(self, on: bool) -> None:
        if self.record_cameras:
            for cam in ("front", "wrist"):
                self.s.scene[cam]._render_data.render_product.hydra_texture.set_updates_enabled(on)
        self._cameras_on = on and self.record_cameras
        # fast: recording renders after every physics step, as legacy; otherwise once per control step
        every_substep = self._cameras_on and self.render == "fast"
        self._stepper.sim.render_every = 1 if every_substep else _replay.DECIMATION

    def _names_from(self, layout: SceneLayout | None, plan: ScenePlan | None, primary_id: str | None = None) -> None:
        """The scene entities to read: the first goal's cube (today's "cube") and its finger sensor, every cube of a
        plan, and the arm's collision sensors."""
        if layout is None:
            self._cube, self._cube_contact, self._arm_sensors = "cube", "cube_contact", ARM_CONTACT_SENSORS
            self._cubes: dict[str, tuple[str, str]] = {}
        else:
            primary = layout.cube(plan.goals[0].object if plan is not None else primary_id)
            self._cube, self._cube_contact = primary.name, primary.contact
            self._arm_sensors = layout.arm_contact_sensors()
            self._cubes = {c: (layout.cube(c).name, layout.cube(c).contact) for c in layout.cube_ids()}

    @property
    def body_key(self) -> tuple:
        """What this sim was built with (plan_layout.body_key): a plan with the same key can be placed in it."""
        return body_key(self.layout if self.layout is not None else layout_for_scene(STANDARD_SCENE))

    def reset(self, scene: Scene, layout: SceneLayout | None = None) -> None:
        """Place the scene (a plan's layout when given: one with this sim's bodies), then hold the robot's default
        joint pose for a few control steps, so the robot data is fresh (and the cameras warm) before the session
        reads the start tool pose."""
        s = self.s
        if layout is not None:
            if body_key(layout) != self.body_key:
                raise ValueError("this sim was built for other bodies; the sink must restart in that scene")
            self.layout = layout
            # the goal cube is the one at scene.cube_pose (teleop_scenes.scene_for_plan): read every cube from now on
            goal = min(layout.cube_ids(),
                       key=lambda c: float(np.linalg.norm(np.subtract(layout.cube(c).pos, scene.cube_pose.pos))))
            self._names_from(layout, None, goal)
            _replay._place_scene(s, scene, layout=layout)
        else:
            _replay._place_scene(s, scene)
        robot = s.scene["robot"]
        default = robot.data.default_joint_pos.torch.clone()
        zeros = torch.zeros_like(default)
        for _ in range(SETTLE_STEPS):
            for _ in range(_replay.DECIMATION):
                robot.set_joint_position_target_index(target=default)
                robot.set_joint_velocity_target_index(target=zeros)
                s.scene.write_data_to_sim()
                s.sim.step()
                s.scene.update(PHYSICS_DT)
        self._prev_cmd = None
        self._prev_pos = None
        self._action = default

    def set_recording(self, on: bool) -> None:
        """fast/fastest: run the recording cameras only while recording (legacy: a no-op)."""
        if self.render == "legacy" or not self.record_cameras or on == self._cameras_on:
            return
        self._set_cameras(on)
        if on:
            for _ in range(RESUME_WARMUP_RENDERS):
                self.s.sim.render()

    def _time(self, name: str):
        return self.sections.time(name) if self.sections is not None else nullcontext()

    def apply(self, target: Pose, gripper: int) -> None:
        s = self.s
        pos = np.asarray(target.pos, dtype=np.float64)
        with self._time("ik"):
            cmd = _replay._hand_target(s, pos, target.quat_wxyz)
            vel = None
            if self.vel_ff and self._prev_cmd is not None and np.linalg.norm(pos - self._prev_pos) <= MAX_FF_STEP_M:
                vel = _replay._joint_vel_ff(s, self._prev_cmd, cmd)
            if self._sync is not None:
                self._sync()
        # the per-substep IK inside _physics_step is charged to "other" (step wall minus the timed sections)
        self._action = _replay._physics_step(self._stepper, cmd, int(gripper), joint_vel=vel)
        self._prev_cmd, self._prev_pos = cmd, pos

    @property
    def joint_names(self) -> list[str]:
        """The robot's joints in joint_pos order (Isaac Lab's articulation order)."""
        return list(self.s.scene["robot"].joint_names)

    def read_twin(self) -> TwinState:
        """Joints and cube pose for the robot twin: one small GPU-to-CPU copy, no contacts or cameras."""
        with self._time("twin"):
            s = self.s
            cube = s.scene[self._cube].data.root_pose_w.torch[0]  # pos + quat (x, y, z, w), world frame
            row = torch.cat([s.scene["robot"].data.joint_pos.torch[0], cube[0:3] - s.scene.env_origins[0], cube[3:7]])
            v = row.cpu().numpy().astype(np.float64)
            cubes = None
            if self._cubes:
                origin = s.scene.env_origins[0]
                rows = torch.stack([torch.cat([s.scene[name].data.root_pose_w.torch[0][0:3] - origin,
                                               s.scene[name].data.root_pose_w.torch[0][3:7]])
                                    for name, _ in self._cubes.values()]).cpu().numpy().astype(np.float64)
                cubes = {c: np.concatenate([r[0:3], _replay._wxyz(r[3:7])]) for c, r in zip(self._cubes, rows)}
        n = v.shape[0] - 7
        return TwinState(joint_pos=v[:n], cube_pose=np.concatenate([v[n:n + 3], _replay._wxyz(v[n + 3:])]), cubes=cubes)

    def settle_check(self, plan: ScenePlan) -> list[str]:
        """The settle check (sim_worker.settle) in this sim, right after a reset: hold the robot still for SETTLE_S
        with nothing touching the scene, then report every cube that moved, fell or tipped ([] = it stands)."""
        s = self.s
        lay = self.layout if self.layout is not None else layout_for_plan(plan)
        before = {c: (lay.cube(c).pos, lay.cube(c).quat_wxyz) for c in lay.cube_ids()}
        robot = s.scene["robot"]
        hold = robot.data.default_joint_pos.torch.clone()
        for _ in range(int(round(SETTLE_S / PHYSICS_DT))):
            robot.set_joint_position_target_index(target=hold)
            s.scene.write_data_to_sim()
            s.sim.step()
            s.scene.update(PHYSICS_DT)
        return settle_errors(plan, before, read_cube_poses(s.scene, lay))

    def read_contact(self) -> ContactReading:
        """The arm's hardest push on the bin or table over the last control step, and which body: the success
        check's sensors (ARM_CONTACT_SENSORS), whose filter columns are the arm bodies in the order the scene lists
        them (scene_cfg ARM_BODIES); a body's name is its prim's last path segment, the twin's URDF link name."""
        with self._time("contact"):
            s = self.s
            forces: dict[str, list[np.ndarray]] = {}
            bodies: list[str] | None = None
            for group, sensors in self._arm_sensors.items():
                for name in sensors:
                    sensor = s.scene[name]
                    hist = sensor.data.normal_force_matrix_w_history
                    t = hist.torch if hist is not None else sensor.data.normal_force_matrix_w.torch
                    forces.setdefault(group, []).append(t.cpu().numpy())
                    bodies = bodies or [p.rsplit("/", 1)[-1] for p in sensor.cfg.filter_prim_paths_expr]
        return peak_contact(forces, bodies or [])

    def _read_objects(self) -> dict[str, tuple[np.ndarray, bool]]:
        """Every cube of a plan's scene: position (env frame) and finger contact, as replay.py records them."""
        s = self.s
        return {c: ((s.scene[name].data.root_pos_w.torch[0] - s.scene.env_origins[0]).cpu().numpy(),
                    _replay._max_pair_force(s.scene[contact]) > CONTACT_N)
                for c, (name, contact) in self._cubes.items()}

    def read_state(self) -> StepState:
        with self._time("read"):
            return self._read_state()

    def _read_state(self) -> StepState:
        s = self.s
        robot, cube = s.scene["robot"], s.scene[self._cube]
        tcp, quat = _replay._tcp_pose(s)
        forces = {group: max(_replay._max_pair_force(s.scene[name]) for name in sensors)
                  for group, sensors in self._arm_sensors.items()}
        frames = {}
        if self.record_cameras and self._cameras_on:
            for cam in ("front", "wrist"):
                frames[cam] = s.scene[cam].data.output["rgb"].torch[0, ..., :3].cpu().numpy().astype(np.uint8)
        return StepState(
            joint_pos=robot.data.joint_pos.torch[0].cpu().numpy(),
            action=self._action[0].cpu().numpy(),
            ee_pos=np.asarray(tcp, dtype=np.float64),
            ee_quat=np.asarray(quat, dtype=np.float64),
            cube_pos=(cube.data.root_pos_w.torch[0] - s.scene.env_origins[0]).cpu().numpy(),
            contact_gripper_cube=_replay._max_pair_force(s.scene[self._cube_contact]) > CONTACT_N,
            contact_arm_bin=forces["bin"] > CONTACT_N,
            contact_arm_table=forces["table"] > CONTACT_N,
            max_contact_force=float(max(forces.values())),
            frames=frames,
            objects=self._read_objects() if self._cubes else None,
        )
