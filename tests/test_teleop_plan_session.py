"""TeleopSession in a ScenePlan (the Record page's scene picker): the plan's bodies placed, every cube recorded, the
verdict from demo_pipeline.goals, assist zones from the plan, the twin showing every object, each demo labelled with
its plan's id and hash, and switching scenes (in the same sim when the bodies match, else a sim restart).
No Isaac: a fake driver moves cubes the way the arm would."""

from __future__ import annotations

import json

import numpy as np
import pytest

from demo_pipeline.goals import goals_from_plan
from demo_pipeline.scene_library import SceneLibrary, plan_hash, protocol_entries, standard_plan
from demo_pipeline.scene_plan import ScenePlan
from demo_pipeline.schemas import Pose, Scene, ScenePlanRef
from demo_pipeline.store import DemoStore
from demo_pipeline.teleop import HandPoseMsg
from sim_worker.object_record import load_scene_signals
from sim_worker.plan_layout import body_key, layout_for_plan, layout_for_scene
from sim_worker.teleop_scenes import SceneSwitcher, scene_for_plan
from sim_worker.teleop_session import TELEOP_DT, StepState, TeleopSession, TwinState, make_store_saver

DOWN = (0.0, 1.0, 0.0, 0.0)
PROTO = {e.id: e for e in protocol_entries()}
START = (0.40, 0.0, 0.30)


class PlanDriver:
    """The tool goes straight to each target. A closing gripper within 3 cm of a cube's centre holds it; opening drops
    it straight down onto a bin's floor (when over one) or the table."""

    joint_names = ["j1", "j2"]

    def __init__(self) -> None:
        self.resets: list = []
        self.layout = None

    def reset(self, scene: Scene, layout=None) -> None:
        self.layout = layout if layout is not None else layout_for_scene(scene)
        self.resets.append(self.layout)
        self.size = {c: self.layout.cube(c).size[0] for c in self.layout.cube_ids()}
        self.cubes = {c: np.array(self.layout.cube(c).pos, dtype=float) for c in self.layout.cube_ids()}
        self.tcp, self.gripper, self.held = np.array(START), 0, None

    def apply(self, target: Pose, gripper: int) -> None:
        self.tcp = np.array(target.pos, dtype=float)
        if gripper and not self.gripper:
            near = [c for c, p in self.cubes.items() if np.linalg.norm(p - self.tcp) < 0.03]
            self.held = near[0] if near else None
        if not gripper and self.held is not None:
            self.cubes[self.held] = self._rest(self.held, self.tcp)
            self.held = None
        if self.held is not None:
            self.cubes[self.held] = self.tcp.copy()
        self.gripper = gripper

    def _rest(self, c: str, at: np.ndarray) -> np.ndarray:
        for bid, pose, inner in self.layout.bins:
            if abs(at[0] - pose.pos[0]) < inner[0] / 2 and abs(at[1] - pose.pos[1]) < inner[1] / 2:
                return np.array([at[0], at[1], pose.pos[2] + 0.01 + self.size[c] / 2])
        return np.array([at[0], at[1], self.size[c] / 2])

    def read_state(self) -> StepState:
        primary = self.layout.cube_ids()[0]
        return StepState(
            joint_pos=np.zeros(2), action=np.zeros(2), ee_pos=self.tcp.copy(), ee_quat=np.array(DOWN),
            cube_pos=self.cubes[primary].copy(), contact_gripper_cube=self.held == primary, contact_arm_bin=False,
            contact_arm_table=False, max_contact_force=0.0,
            objects={c: (p.copy(), self.held == c) for c, p in self.cubes.items()},
        )

    def read_twin(self) -> TwinState:
        primary = self.layout.cube_ids()[0]
        return TwinState(joint_pos=np.zeros(2), cube_pose=np.array([*self.cubes[primary], 1.0, 0, 0, 0]),
                         cubes={c: np.array([*p, 1.0, 0, 0, 0]) for c, p in self.cubes.items()})


def msg_at(x: float, y: float, z: float, closed: bool) -> HandPoseMsg:
    """A hand whose target (demo_pipeline.teleop.to_ee_target, default calibration) is x, y, z."""
    s_x, s_y, s_z = (x - 0.30) / 0.40, (0.35 - y) / 0.70, (z - 0.02) / 0.38
    return HandPoseMsg(t_ms=0.0, tracking_ok=True, wrist_uv=(0.5, 0.5), palm_width=0.1,
                       pinch_ratio=0.1 if closed else 0.8, yaw_rad=0.0, frame_w=640, frame_h=480,
                       control=(1.0 - s_y, 1.0 - s_z, s_x))


def ref(entry) -> ScenePlanRef:
    return ScenePlanRef(id=entry.id, hash=entry.hash, name=entry.name)


@pytest.fixture
def rig(tmp_path):
    store, t = DemoStore(tmp_path), [1000.0]
    ids = iter(f"human_test_{i}" for i in range(100))

    def make(plan: ScenePlan | None, scene_ref=None, driver=None):
        driver = driver or PlanDriver()
        scene = scene_for_plan(plan) if plan is not None else scene_for_plan(standard_plan())
        session = TeleopSession(driver, scene, make_store_saver(store), clock=lambda: t[0], new_id=lambda: next(ids),
                                plan=plan, scene_ref=scene_ref)

        def run(steps: int, msg: HandPoseMsg) -> None:
            for _ in range(steps):
                session.on_hand(msg)
                session.step()
                t[0] += TELEOP_DT

        return session, driver, run

    return make, store


def pick_and_place(run, cube_xy, bin_xy) -> None:
    """Over the cube, down, close, up, over the bin, down to the soft floor, open, wait."""
    cx, cy = cube_xy
    bx, by = bin_xy
    run(10, msg_at(cx, cy, 0.20, False))
    run(10, msg_at(cx, cy, 0.03, False))
    run(5, msg_at(cx, cy, 0.03, True))
    run(10, msg_at(cx, cy, 0.25, True))
    run(10, msg_at(bx, by, 0.25, True))
    run(10, msg_at(bx, by, 0.05, True))  # the soft floor holds it at the rim
    run(5, msg_at(bx, by, 0.05, False))
    run(40, msg_at(bx, by, 0.25, False))


def xy(plan, oid):
    p = plan.object(oid).pose
    return p.x, p.y


# --- one scene ----------------------------------------------------------------------------------

def test_the_plans_bodies_are_placed_and_the_twin_shows_every_object(rig):
    make, _ = rig
    plan = PROTO["s7"].plan
    session, driver, _ = make(plan, ref(PROTO["s7"]))
    assert driver.resets[-1] == layout_for_plan(plan)
    scene_msg = session.twin_scene()
    objs = {o["id"]: o for o in scene_msg["objects"]}
    assert set(objs) == {"cube", "distractor", "bin"}
    assert objs["distractor"]["color"] == "yellow" and objs["distractor"]["size"] == 0.05
    assert objs["bin"]["inner"] == [0.2, 0.2, 0.08] and len(objs["bin"]["pose"]) == 7
    frame = session.twin()
    assert set(frame["cubes"]) == {"cube", "distractor"} and len(frame["cubes"]["distractor"]) == 7


def test_the_soft_floor_comes_from_the_plans_bin(rig):
    make, _ = rig
    s8 = PROTO["s8"].plan  # an 11 cm bin: rim 0.12, floor 0.11
    session, driver, run = make(s8, ref(PROTO["s8"]))
    bx, by = xy(s8, "bin")
    run(20, msg_at(bx, by, 0.05, False))
    assert driver.tcp[2] == pytest.approx(0.11)


def test_putting_the_red_cube_in_the_bin_is_a_success_by_the_goals(rig):
    make, store = rig
    plan = PROTO["s7"].plan
    session, _, run = make(plan, ref(PROTO["s7"]))
    session.on_control("record_start")
    pick_and_place(run, xy(plan, "cube"), xy(plan, "bin"))
    session.on_control("record_stop")
    assert session.last_result == "saved human_test_0: verified success"
    demo = store.get_demo("human_test_0")
    assert demo.scene_plan == ScenePlanRef(id="s7", hash=plan_hash(plan), name="S7 Yellow distractor")
    ep = store.episode_dir("human_test_0")
    assert ScenePlan.model_validate_json((ep / "plan.json").read_text(encoding="utf-8")) == plan
    goals = json.loads((ep / "goals.json").read_text(encoding="utf-8"))
    assert goals["success"] is True and [g["state"] for g in goals["goals"]] == ["done"]
    sig = load_scene_signals(ep)
    assert set(sig.objects) == {"cube", "distractor"}


def test_putting_the_wrong_cube_in_fails(rig):
    make, _ = rig
    plan = PROTO["s7"].plan
    session, _, run = make(plan, ref(PROTO["s7"]))
    session.on_control("record_start")
    pick_and_place(run, xy(plan, "distractor"), xy(plan, "bin"))
    session.on_control("record_stop")
    assert session.last_result == "saved human_test_0: not verified (not_in_bin)"


@pytest.mark.parametrize("place", [True, False])
def test_the_standard_plan_gives_exactly_todays_verdict_and_signals(rig, place):
    """S1 through the plan path vs no plan (today's path): the same words, the same signals.npz."""
    make, store = rig
    std = standard_plan()
    results = []
    for plan in (None, std):
        session, _, run = make(plan, ref(PROTO["s1"]) if plan is not None else None)
        session.on_control("record_start")
        pick_and_place(run, xy(std, "cube"), xy(std, "bin") if place else (0.45, 0.15))
        session.on_control("record_stop")
        results.append(session.last_result.split(": ", 1)[1])
        with np.load(store.episode_dir(session.last_demo_id) / "signals.npz") as z:
            results.append({k: z[k].tolist() for k in z.files})
    assert results[0] == results[2] and results[1] == results[3]
    assert results[0] == "verified success" if place else results[0].startswith("not verified (")


def test_without_a_plan_nothing_changes(rig):
    make, store = rig
    session, _, run = make(None)
    assert "objects" not in session.twin_scene() and "cubes" not in session.twin() and "scene" not in session.status()
    session.on_control("record_start")
    pick_and_place(run, xy(standard_plan(), "cube"), xy(standard_plan(), "bin"))
    session.on_control("record_stop")
    demo = store.get_demo(session.last_demo_id)
    assert demo.scene_plan is None and "scene_plan" not in json.loads(demo.model_dump_json())
    assert not (store.episode_dir(demo.id) / "plan.json").exists()


def test_the_status_names_the_scene(rig):
    make, _ = rig
    session, _, _ = make(PROTO["s4"].plan, ref(PROTO["s4"]))
    assert session.status()["scene"] == {"id": "s4", "name": "S4 Small cube", "hash": PROTO["s4"].hash,
                                         "settle": None, "switching": None, "playlist": None}


# --- switching scenes ---------------------------------------------------------------------------

@pytest.fixture
def lib(tmp_path):
    lib = SceneLibrary(tmp_path)
    lib.seed_protocol()
    return lib


def test_same_bodies_switch_in_the_same_sim(rig, lib):
    make, _ = rig
    session, driver, _ = make(standard_plan(), ref(lib.get("standard")))
    restarts = []
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=restarts.append)
    session.on_control("set_scene", scene="s3")  # the bin turned and moved: the same cube and bin
    assert restarts == [] and session.plan == lib.get("s3").plan
    assert driver.resets[-1] == layout_for_plan(lib.get("s3").plan)
    assert session.status()["scene"]["id"] == "s3" and session.last_result == "scene: S3 Bin turned, other side"
    assert session.scene.bin_pose.quat_wxyz[0] == pytest.approx(np.cos(np.pi / 4))


def test_new_bodies_ask_for_a_sim_restart(rig, lib):
    make, _ = rig
    session, driver, _ = make(standard_plan(), ref(lib.get("standard")))
    restarts = []
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=restarts.append)
    session.on_control("set_scene", scene="s7")  # a second cube: Isaac has to build the scene again
    assert [e.id for e in restarts] == ["s7"]
    assert session.plan == standard_plan()  # still the old one until the sim comes back
    assert session.status()["scene"]["switching"] == "s7"
    assert "restarting the sim" in session.last_result


def test_no_switch_while_recording_or_for_an_unknown_scene(rig, lib):
    make, _ = rig
    session, driver, _ = make(standard_plan(), ref(lib.get("standard")))
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=lambda e: None)
    session.on_control("record_start")
    session.on_control("set_scene", scene="s3")
    assert session.last_result == "stop recording first, then change the scene" and session.plan == standard_plan()
    session.on_control("record_discard")
    with pytest.raises(ValueError, match="no scene 'nope'"):
        session.on_control("set_scene", scene="nope")


def test_a_sim_without_a_switcher_says_so(rig):
    make, _ = rig
    session, _, _ = make(None)
    session.on_control("set_scene", scene="s3")
    assert session.last_result == "this sim can't change scenes; restart the sink with --scene"


def test_the_goals_are_the_plans():
    assert [(g.object, g.container) for g in goals_from_plan(PROTO["s7"].plan)] == [("cube", "bin")]


# --- a scene list for a recording session (the lead's addition) -------------------------------------

from sim_worker.teleop_scenes import ScenePlaylist  # noqa: E402


def record_one(session, run, plan) -> None:
    session.on_control("record_start")
    pick_and_place(run, xy(plan, "cube"), xy(plan, "bin"))
    session.on_control("record_stop")


def test_the_list_moves_to_the_next_scene_after_each_saved_take(rig, lib):
    make, _ = rig
    session, driver, run = make(lib.get("s1").plan, ref(lib.get("s1")))
    restarts = []
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=restarts.append,
                                           playlist=ScenePlaylist.start(lib, ["s1", "s2", "s3"], takes_per_scene=1))
    record_one(session, run, session.plan)
    assert session.scene_ref.id == "s2" and session.status()["scene"]["playlist"] == {"index": 1, "of": 3, "take": 0, "takes_per_scene": 1}
    session.on_control("record_start")
    session.on_control("record_discard")  # a discarded take doesn't count
    assert session.scene_ref.id == "s2"
    record_one(session, run, session.plan)
    record_one(session, run, session.plan)
    assert session.scene_ref.id == "s1"  # round two
    assert restarts == []  # S1-S3 share their bodies


def test_two_takes_per_scene(rig, lib):
    make, _ = rig
    session, driver, run = make(lib.get("s1").plan, ref(lib.get("s1")))
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=lambda e: None,
                                           playlist=ScenePlaylist.start(lib, ["s1", "s2"], takes_per_scene=2))
    record_one(session, run, session.plan)
    assert session.scene_ref.id == "s1" and session.status()["scene"]["playlist"]["take"] == 1
    record_one(session, run, session.plan)
    assert session.scene_ref.id == "s2"


def test_the_list_survives_a_sim_restart(rig, lib):
    make, _ = rig
    session, driver, run = make(lib.get("s3").plan, ref(lib.get("s3")))
    restarts = []
    session.scene_switcher = SceneSwitcher(lib, session, current_key=body_key(driver.layout), restart=restarts.append,
                                           playlist=ScenePlaylist.start(lib, ["s3", "s4"], takes_per_scene=1))
    record_one(session, run, session.plan)
    assert [e.id for e in restarts] == ["s4"]  # a 4 cm cube: a new sim
    resumed = ScenePlaylist.resume(lib)
    assert resumed.current() == "s4" and resumed.index == 1


def test_a_list_must_name_real_scenes(lib):
    with pytest.raises(ValueError, match="no scene 'nope'"):
        ScenePlaylist.start(lib, ["s1", "nope"])
    with pytest.raises(ValueError, match="empty"):
        ScenePlaylist.start(lib, [])


def test_the_sessions_messages_pass_the_relays_checks(rig):
    from app.routers.teleop import SimStatusMsg, SimTwinMsg, SimTwinSceneMsg

    make, _ = rig
    session, _, _ = make(PROTO["s7"].plan, ref(PROTO["s7"]))
    SimStatusMsg.model_validate(session.status())
    SimTwinSceneMsg.model_validate(session.twin_scene())
    SimTwinMsg.model_validate(session.twin())


# --- the sink's scene start and restart (pure parts) ----------------------------------------------

from sim_worker.teleop_scenes import (  # noqa: E402
    next_sink_args, prepare_scene, read_next_scene, request_restart, should_settle,
)


def test_no_scene_arguments_keep_todays_sink(lib):
    assert prepare_scene(lib, scene=None, scene_list=None, takes_per_scene=1, resume=False) == (None, None)


def test_a_scene_argument_starts_in_that_scene(lib):
    entry, playlist = prepare_scene(lib, scene="s6", scene_list=None, takes_per_scene=1, resume=False)
    assert entry.id == "s6" and playlist is None


def test_a_scene_list_starts_at_its_first_and_a_resume_carries_on(lib):
    entry, playlist = prepare_scene(lib, scene=None, scene_list=["s4", "s1"], takes_per_scene=2, resume=False)
    assert entry.id == "s4" and playlist.ids == ["s4", "s1"] and playlist.takes_per_scene == 2
    playlist.after_save()
    playlist.after_save()  # on to s1
    entry, resumed = prepare_scene(lib, scene="s1", scene_list=None, takes_per_scene=1, resume=True)
    assert entry.id == "s1" and resumed.index == 1 and resumed.takes_per_scene == 2


def test_the_restart_request_is_read_once(lib):
    request_restart(lib, lib.get("s7"))
    assert read_next_scene(lib) == "s7"
    assert read_next_scene(lib) is None


def test_the_restarted_sink_gets_the_next_scene_and_keeps_its_other_arguments():
    args = ["--viz", "kit", "--scene-list", "s1,s4", "--takes-per-scene", "2", "--render", "fast"]
    assert next_sink_args(args, "s4", playlist=True) == ["--viz", "kit", "--render", "fast", "--scene", "s4",
                                                          "--resume-playlist"]
    assert next_sink_args(["--scene", "s1", "--no-cameras"], "s7", playlist=False) == ["--no-cameras", "--scene", "s7"]
    assert next_sink_args(["--scene=s1"], "s8", playlist=False) == ["--scene", "s8"]


def test_the_settle_check_runs_for_new_bodies_until_it_has_passed_for_this_plan(lib):
    assert not should_settle(lib.get("s2"))  # today's bodies
    assert should_settle(lib.get("s8"))
    lib.record_settle("s8", ok=True, errors=[])
    assert not should_settle(lib.get("s8"))
    lib.record_settle("s8", ok=False, errors=["cube moved"])
    assert should_settle(lib.get("s8"))  # a failed check is run again next time


from sim_worker.teleop_scenes import RESTART_EXIT, sink_loop  # noqa: E402


def test_the_loop_restarts_the_sink_in_the_scene_it_asked_for(lib):
    runs = []

    def run(args):
        runs.append(list(args))
        if len(runs) == 1:
            request_restart(lib, lib.get("s7"))
            return RESTART_EXIT
        return 0

    assert sink_loop(["--viz", "kit", "--scene-list", "s1,s7"], lib, run, log=lambda m: None) == 0
    assert runs == [["--viz", "kit", "--scene-list", "s1,s7"], ["--viz", "kit", "--scene", "s7", "--resume-playlist"]]


def test_the_loop_stops_on_any_other_exit_and_on_a_restart_without_a_scene(lib):
    assert sink_loop(["--scene", "s1"], lib, lambda a: 3, log=lambda m: None) == 3
    assert sink_loop(["--scene", "s1"], lib, lambda a: RESTART_EXIT, log=lambda m: None) == 1
