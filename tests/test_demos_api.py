"""Backend demo routes: /demos CRUD and /demos/{id}/diagnose with the rules fallback (Review Focus 5)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
import pytest

from app.ai.diagnose import MAX_IMAGES, DiagnosisError
from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.measure import compute_windows
from demo_pipeline.rules import TASK_TEXT, detect_rules
from demo_pipeline.schemas import (
    Demo,
    Diagnosis,
    Passport,
    Pose,
    Scene,
    SimSignals,
    Trajectory,
    VerificationResult,
)
from demo_pipeline.store import DemoStore
from demo_pipeline.success import check_success
from nebius_llm import AuthError, RateLimitError
from nebius_llm.config import get_vision_model

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
T0 = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)
N = 100  # 2 s at 50 Hz
CLOSE_STEP, OPEN_STEP = 40, 80
VL_MODEL = get_vision_model("nemotron-vl").model_id


@pytest.fixture
def demos_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return api


@pytest.fixture
def store(demos_api, tmp_path):
    return DemoStore(tmp_path / "data")


def _traj(n=N):
    t = [i * 0.02 for i in range(n)]
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if CLOSE_STEP <= i < OPEN_STEP else 0 for i in range(n)]
    return Trajectory(t=t, ee_pos=pos, ee_quat=[DOWN] * n, gripper=grip)


def _scene():
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=7)


def _demo(id="human_1", source="human", parent_id=None, minutes=0, n=N):
    return Demo(id=id, source=source, parent_id=parent_id, trajectory=_traj(n), scene=_scene(),
                created_at=T0 + timedelta(minutes=minutes), human_seconds=10.0 if source == "human" else 0.0)


def _signals(n=N):
    traj = _traj(n).to_arrays()
    cube = np.tile([0.5, 0.0, 0.025], (n, 1))
    cube[CLOSE_STEP:] = traj["ee_pos"][CLOSE_STEP:]
    cube[OPEN_STEP:] = [0.5, 0.3, 0.025]
    grip = np.zeros(n, dtype=bool)
    grip[CLOSE_STEP:OPEN_STEP] = True
    return SimSignals(cube_pos=cube, contact_gripper_cube=grip, contact_arm_bin=np.zeros(n, dtype=bool),
                      contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n))


def _png(camera: str, step: int) -> bytes:
    return f"PNG {camera} {step}".encode()  # the route passes bytes through; diagnose() is mocked


def _write_episode(store, demo_id="human_1", *, cameras=("front", "wrist"), n=N, signals=True):
    ep = store.episode_dir(demo_id)
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK_TEXT, fps=50, n_steps=n, cameras=list(cameras))
    traj = _traj(n).to_arrays()
    save_episode(ep, meta, {"joint_pos": np.zeros((n, 9)), "action": np.zeros((n, 9)), "ee_pos": traj["ee_pos"],
                            "ee_quat": traj["ee_quat"], "gripper": traj["gripper"]})
    for cam in cameras:
        for i in range(n):
            image_path(ep, cam, i).write_bytes(_png(cam, i))
    if signals:
        save_signals(ep, _signals(n))
    return ep


def _diagnosis(decision="keep"):
    return Diagnosis.model_validate({
        "segments": [{"name": "approach", "t0": 0.0, "t1": 0.8}],
        "issues": [],
        "repairs": [],
        "decision": decision,
        "label": TASK_TEXT,
    })


def _post(api, demo):
    return api.post("/demos", content=demo.model_dump_json(), headers={"content-type": "application/json"})


def _diagnose(api, demo_id="human_1", *, returns=None, raises=None):
    with patch("app.routers.demos.diagnose") as mock:
        if raises is not None:
            mock.side_effect = raises
        else:
            mock.return_value = returns or _diagnosis()
        return api.post(f"/demos/{demo_id}/diagnose"), mock


# --- POST / GET /demos -----------------------------------------------------------------

def test_post_demo_returns_201_with_id_and_it_can_be_read_back(demos_api):
    r = _post(demos_api, _demo())
    assert r.status_code == 201
    assert r.json() == {"id": "human_1"}
    got = demos_api.get("/demos/human_1")
    assert got.status_code == 200
    assert Demo.model_validate(got.json()) == _demo()


def test_post_duplicate_id_is_409(demos_api):
    assert _post(demos_api, _demo()).status_code == 201
    assert _post(demos_api, _demo()).status_code == 409


def test_post_unsafe_id_is_422(demos_api):
    demo = _demo().model_copy(update={"id": "../escape"})
    assert _post(demos_api, demo).status_code == 422


def test_post_invalid_demo_is_422(demos_api):
    data = _demo().model_dump(mode="json")
    data["parent_id"] = "someone"  # a human demo has no parent
    assert demos_api.post("/demos", json=data).status_code == 422


def test_list_is_newest_first_and_filters_by_source(demos_api):
    _post(demos_api, _demo("human_1", minutes=0))
    _post(demos_api, _demo("variant_1", source="variant", parent_id="human_1", minutes=5))
    _post(demos_api, _demo("human_2", minutes=10))
    assert [d["id"] for d in demos_api.get("/demos").json()] == ["human_2", "variant_1", "human_1"]
    assert [d["id"] for d in demos_api.get("/demos", params={"source": "variant"}).json()] == ["variant_1"]


def test_list_with_unknown_source_is_422(demos_api):
    assert demos_api.get("/demos", params={"source": "robot"}).status_code == 422


def test_get_missing_demo_is_404(demos_api):
    assert demos_api.get("/demos/nope").status_code == 404


def test_get_unsafe_id_is_404(demos_api):
    assert demos_api.get("/demos/bad.id").status_code == 404


def test_get_corrupt_demo_is_422(demos_api, store):
    d = store.root / "demos" / "broken"
    d.mkdir(parents=True)
    (d / "demo.json").write_text("{not json", encoding="utf-8")
    assert demos_api.get("/demos/broken").status_code == 422


# --- diagnose: the happy path -----------------------------------------------------------

def test_diagnose_returns_and_saves_the_nemotron_diagnosis(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store)
    r, _ = _diagnose(demos_api)
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "nemotron"
    assert body["model_id"] == VL_MODEL
    assert Diagnosis.model_validate(body["diagnosis"]) == _diagnosis()
    assert store.get_diagnosis("human_1") == (_diagnosis(), "nemotron", VL_MODEL)


def test_diagnose_sends_subsampled_front_frames_and_the_wrist_frame_at_first_close(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store)
    _, mock = _diagnose(demos_api)
    (frames, wrist, windows, task_text, replay_success, duration), _ = mock.call_args
    assert len(frames) == MAX_IMAGES - 1
    assert frames[0] == (0.0, _png("front", 0))
    assert frames[-1] == (pytest.approx(_traj().t[-1]), _png("front", N - 1))
    assert all(png == _png("front", round(t / 0.02)) for t, png in frames)
    assert wrist == _png("wrist", CLOSE_STEP)
    assert windows == compute_windows(_traj(), _signals())
    assert task_text == TASK_TEXT
    assert duration == pytest.approx(_traj().duration)


def test_diagnose_without_wrist_camera_sends_eight_front_frames_and_no_wrist(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store, cameras=("front",))
    _, mock = _diagnose(demos_api)
    frames, wrist = mock.call_args.args[:2]
    assert len(frames) == MAX_IMAGES
    assert wrist is None


def test_replay_success_without_a_passport_comes_from_the_signals(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store)
    _, mock = _diagnose(demos_api)
    expected = check_success(_traj(), _signals(), _scene().bin_pose)
    assert expected.reasons == ["not_settled"]  # the fixture's cube rests only 0.4 s
    assert mock.call_args.args[4] is False


def test_replay_success_comes_from_the_stored_passport_when_there_is_one(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store)
    store.save_passport("human_1", Passport(
        demo_id="human_1", lineage=["human_1"], diagnosis_source="none", robot="franka",
        verification=VerificationResult(success=True, duration=2.0, path_length=0.5, max_contact_force=0.0),
        pipeline_version="test",
    ))
    _, mock = _diagnose(demos_api)
    assert mock.call_args.args[4] is True  # the signals alone say not_settled


def test_diagnosis_can_be_read_back(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store)
    _diagnose(demos_api)
    r = demos_api.get("/demos/human_1/diagnosis")
    assert r.status_code == 200
    assert r.json()["source"] == "nemotron"
    assert r.json()["model_id"] == VL_MODEL
    assert Diagnosis.model_validate(r.json()["diagnosis"]) == _diagnosis()


# --- diagnose: the rules fallback --------------------------------------------------------

@pytest.mark.parametrize("error", [
    DiagnosisError("no valid diagnosis after 2 attempts"),
    AuthError("NEBIUS_API_KEY is not set"),
    RateLimitError("429"),
])
def test_diagnose_falls_back_to_rules(demos_api, store, error):
    _post(demos_api, _demo())
    _write_episode(store)
    r, _ = _diagnose(demos_api, raises=error)
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "rules"
    assert body["model_id"] is None
    expected = detect_rules(_traj(), compute_windows(_traj(), _signals()), TASK_TEXT)
    assert Diagnosis.model_validate(body["diagnosis"]) == expected
    assert store.get_diagnosis("human_1") == (expected, "rules", None)


# --- diagnose: clear errors, never a 500 (Review Focus 5) -----------------------------------

def test_diagnose_missing_demo_is_404(demos_api):
    r, mock = _diagnose(demos_api, "nope")
    assert r.status_code == 404
    mock.assert_not_called()


def test_diagnose_without_episode_is_409(demos_api):
    _post(demos_api, _demo())
    r, mock = _diagnose(demos_api)
    assert r.status_code == 409
    assert "episode" in r.json()["detail"]
    mock.assert_not_called()


def test_diagnose_without_signals_is_409(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store, signals=False)
    r, mock = _diagnose(demos_api)
    assert r.status_code == 409
    assert "signals" in r.json()["detail"]
    mock.assert_not_called()


def test_diagnose_without_front_frames_is_409(demos_api, store):
    _post(demos_api, _demo())
    _write_episode(store, cameras=("wrist",))
    r, mock = _diagnose(demos_api)
    assert r.status_code == 409
    assert "front" in r.json()["detail"]
    mock.assert_not_called()


def _corrupt_episode_json(ep):
    (ep / "episode.json").write_text("{not json", encoding="utf-8")


def _corrupt_steps(ep):
    (ep / "steps.npz").write_bytes(b"not a zip")


def _corrupt_signals(ep):
    (ep / "signals.npz").write_bytes(b"not a zip")


def _signals_missing_a_field(ep):
    s = _signals()
    np.savez(ep / "signals.npz", cube_pos=s.cube_pos)


def _missing_frame(ep):
    image_path(ep, "front", 0).unlink()


@pytest.mark.parametrize("corrupt", [
    _corrupt_episode_json, _corrupt_steps, _corrupt_signals, _signals_missing_a_field, _missing_frame,
])
def test_diagnose_on_corrupt_episode_files_is_422(demos_api, store, corrupt):
    _post(demos_api, _demo())
    corrupt(_write_episode(store))
    r, mock = _diagnose(demos_api)
    assert r.status_code == 422
    mock.assert_not_called()


def test_diagnose_when_episode_length_differs_from_the_demo_is_422(demos_api, store):
    _post(demos_api, _demo(n=N))
    _write_episode(store, n=N - 10)
    r, mock = _diagnose(demos_api)
    assert r.status_code == 422
    assert "steps" in r.json()["detail"]
    mock.assert_not_called()


def test_get_diagnosis_before_diagnose_is_404(demos_api):
    _post(demos_api, _demo())
    assert demos_api.get("/demos/human_1/diagnosis").status_code == 404


def test_get_diagnosis_of_missing_demo_is_404(demos_api):
    assert demos_api.get("/demos/nope/diagnosis").status_code == 404


def test_get_corrupt_diagnosis_is_422(demos_api, store):
    _post(demos_api, _demo())
    (store.root / "demos" / "human_1" / "diagnosis.json").write_text("{}", encoding="utf-8")
    assert demos_api.get("/demos/human_1/diagnosis").status_code == 422
