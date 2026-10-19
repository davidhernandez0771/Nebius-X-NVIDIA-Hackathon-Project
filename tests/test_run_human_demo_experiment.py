"""scripts/run_human_demo_experiment.py end to end on fakes: FakeSim for Isaac, a fake trainer/eval, a fake judge.

The grid is checked with T3's own reader and integrity check; the results with the shape results.ts parses.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pytest

from app.sim_client import SimWorkerUnavailable
from demo_pipeline.episode_io import EpisodeMeta, save_episode
from demo_pipeline.intent import Label, ObjectRef, Step, Verdict
from demo_pipeline.schemas import Demo
from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim
from lerobot_tools.assemble import Cell, build_manifest
from lerobot_tools.experiments import load_grid
from sim_worker.standin import standin_demo

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_human_demo_experiment.py"
IDS = ["standin_00", "standin_01", "standin_02"]
SMOKE = {"variants": 2, "steps": 2000, "save_freq": 2000, "eval_n": 5, "eval_seed0": 5020, "smoke": True,
         "raw_arm": "all", "judge_copies": 1, "nemotron": True, "max_cost_usd": 0.1,
         "replay_path": "commanded"}  # stand-ins have no live episode: their trajectory is all there is
HUMAN_9F47 = Path(__file__).parent / "data" / "human_9f47"


@pytest.fixture(scope="module")
def hx():
    spec = importlib.util.spec_from_file_location("run_human_demo_experiment", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _user_store(root: Path) -> DemoStore:
    store = DemoStore(root)
    for i, id in enumerate(IDS):
        store.save_demo(standin_demo(7000 + i, id=id)[0])
    return store


def _hashes(root: Path) -> dict:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (root / "demos").rglob("*") if p.is_file()}


class FakeJudge:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def label(self, frames, summary):
        self.calls.append("label")
        if self.fail:
            raise RuntimeError("Token Factory 503")
        return Label(task="pick up the red cube and put it in the blue bin", object=ObjectRef(name="cube", color="red"),
                     destination="bin", objects=[ObjectRef(name="cube", color="red")],
                     steps=[Step(name=n, frames=(i, i)) for i, n in enumerate(("reach", "grasp", "carry", "release"))],
                     confidence=0.9)

    def judge(self, *a):
        self.calls.append("judge")
        if self.fail:
            raise RuntimeError("Token Factory 503")
        return Verdict(same_object=True, same_goal=True, same_order=True, copy_completes=True, matches="yes",
                       reason="same cube, same bin", confidence=0.9)


class FakeChildren:
    """lerobot_tools.experiments and eval_cells.py, as far as the orchestrator can see them: registry rows and
    eval files. eval successes: {cell: set of successful seeds}."""

    def __init__(self, data: Path, successes=None, train_status="ok"):
        self.data, self.cmds = data, []
        self.successes = successes or {"raw_3": {5021}, "perfected_multiply_3": {5020, 5022, 5023}}
        self.train_status = train_status

    def __call__(self, cmd, log_path):
        self.cmds.append(cmd)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("fake\n", encoding="utf-8")
        reg = self.data / "results" / "registry.jsonl"
        if "lerobot_tools.experiments" in cmd:
            grid = load_grid(Path(cmd[cmd.index("--grid") + 1]))
            run_id = f"{grid.name}_20991231_000000"
            reg.parent.mkdir(parents=True, exist_ok=True)
            with reg.open("a", encoding="utf-8") as f:
                for c in grid.cells:
                    ds = self.data / "experiments" / run_id / "datasets" / c.name
                    ds.mkdir(parents=True, exist_ok=True)
                    f.write(json.dumps({"run_id": run_id, "grid": grid.name, "status": self.train_status,
                                        "cell": {"condition": c.condition, "n_human": c.n_human, "name": c.name},
                                        "checkpoint": str(self.data / run_id / c.name / "ckpt"), "dataset": str(ds),
                                        "n_episodes": len(c.episode_dirs), "n_frames": 1, "final_loss": 0.1,
                                        "train_time_s": 1.0, "eval_success": None,
                                        "created": "2099-12-31T00:00:00+00:00"}) + "\n")
            return 0
        run_id = cmd[cmd.index("--run-id") + 1]
        n, seed0 = int(cmd[cmd.index("--n") + 1]), int(cmd[cmd.index("--seed0") + 1])
        rows = [json.loads(line) for line in reg.read_text(encoding="utf-8").splitlines()]
        for r in rows:
            if r["run_id"] != run_id:
                continue
            cell = r["cell"]["name"]
            eps = [{"seed": s, "success": s in self.successes[cell], "reasons": [] if s in self.successes[cell]
                    else ["not_in_bin"], "ended_by": "success" if s in self.successes[cell] else "timeout"}
                   for s in range(seed0, seed0 + n)]
            k = sum(e["success"] for e in eps)
            out = self.data / "evals" / run_id / f"{cell}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({"run": {"cell": cell, "checkpoint": r["checkpoint"], "started": "x"},
                                       "summary": {"n": n, "successes": k, "success_rate": k / n},
                                       "episodes": eps}), encoding="utf-8")
            r["eval_success"] = k / n
            r["eval"] = {"n": n, "successes": k, "evaluated_at": "2099-12-31T01:00:00+00:00"}
        reg.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        return 0


def _exp(hx, data, *, sim=None, judge=None, children=None, stages=None, name="smoke1"):
    user = _user_store(data) if not (data / "demos").is_dir() else DemoStore(data)
    sim = sim or FakeSim(data)
    stages = [] if stages is None else stages

    @contextmanager
    def gpu_stage(task):
        stages.append(task)
        yield

    @contextmanager
    def session():
        with gpu_stage(f"human-exp:{name}:sim"):
            yield sim

    deps = hx.Deps(user_store=user, sim_session=session, gpu_stage=gpu_stage, run=children or FakeChildren(data),
                   judge=judge if judge is not None else FakeJudge(), clip=lambda ep, k: ([(0, b"png")], None),
                   log=lambda m: None)
    return hx.Experiment(data, name, deps), sim, stages


def test_full_smoke_run_on_fakes(hx, tmp_path):
    exp, sim, stages = _exp(hx, tmp_path)
    before = _hashes(tmp_path)
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    exp.run()
    root = tmp_path / "human_exp" / "smoke1"

    # the user's store is read, never written
    assert _hashes(tmp_path) == before
    # every GPU stage held the lock
    assert stages == ["human-exp:smoke1:sim", "human-exp:smoke1:train", "human-exp:smoke1:eval"]
    # the grid passes T3's reader and integrity check
    grid = load_grid(root / "grid.json")
    assert [c.name for c in grid.cells] == ["raw_3", "perfected_multiply_3"]
    raw, mult = (build_manifest(c) for c in grid.cells)
    assert raw["n_episodes"] == 3 and raw["human_roots"] == IDS
    assert mult["n_episodes"] == 3 + 3 * 2 and mult["human_roots"] == IDS  # sources + 2 variants each
    for ep in grid.cells[0].episode_dirs:  # start-aligned raw episodes, no repairs
        assert ep.name == "episode" and ep.parent.name.endswith("_home")
    # FakeSim saw: physics, >= 1 verification, 2 aligned, 2 variants per demo
    names = [r.out_name for r in sim.requests]
    assert sum(n.endswith("_raw") for n in names) == 3 and sum("_m3" in n for n in names) == 6
    assert {n for n in names if "_m3" in n} == {f"standin_0{i}_rules_home_m{3100 + 100 * i + k}" for i in range(3)
                                                  for k in range(2)}
    # every variant starts at home
    variant = exp.store.get_demo("standin_01_rules_home_m3200")
    assert variant.trajectory.ee_pos[0] == pytest.approx([0.45, 0.0, 0.35])

    # results: the shape results.ts parses, marked sample for a smoke run
    res = json.loads((root / "results.json").read_text(encoding="utf-8"))
    assert res["sample"] is True and res["demos"] == [3]
    assert {s["key"] for s in res["series"]} == {"raw", "raw_multiply", "ours"}
    ours = next(s for s in res["series"] if s["key"] == "ours")
    assert ours["success"] == [0.6]
    assert res["multiply_yield"]["ours"] == 1.0
    head = res["experiment"]["headline"]
    assert head["raw"]["successes"] == 1 and head["multiplied"]["successes"] == 3 and head["raw"]["n"] == 5
    assert head["fisher_p"] == pytest.approx(0.5238095, abs=1e-6)
    # the eval details survive next to the stats: which seeds, what is missing, which file
    assert head["raw"]["successful_seeds"] == [5021] and head["multiplied"]["successful_seeds"] == [5020, 5022, 5023]
    assert head["raw"]["missing_seeds"] == [] and head["raw"]["ci"] and head["multiplied"]["file"].endswith(".json")
    assert res["comparisons"][0]["arms"][0]["cell"] == "raw_3"
    # the repair here is rules only (Nemotron labels and judges): no bar may say "Nemotron repair"
    assert res["ablation"] == {"demos": 3, "bars": [{"key": "rules", "label": "Rules repair + multiply (this run)",
                                                     "success": 0.6}]}
    assert not any("Nemotron" in b["label"] for b in res["ablation"]["bars"])
    # the train and eval commands carry the frozen settings
    train_cmd, eval_cmd = exp.deps.run.cmds
    assert train_cmd[train_cmd.index("--steps") + 1] == "2000"
    assert eval_cmd[eval_cmd.index("--n") + 1] == "5" and eval_cmd[eval_cmd.index("--seed0") + 1] == "5020"
    assert eval_cmd[eval_cmd.index("--start-pose") + 1] == "dataset"
    assert eval_cmd[eval_cmd.index("--start-state") + 1].endswith("raw_3")
    # Nemotron: a card next to each human demo and each judged copy, in the experiment store only
    card = json.loads((root / "store" / "demos" / "standin_00" / "review_verdict.json").read_text(encoding="utf-8"))
    assert card["physics"]["status"] == "verified" and card["label"]["status"] == "ok"
    copy = json.loads((root / "store" / "demos" / "standin_00_rules_home_m3100" / "review_verdict.json")
                      .read_text(encoding="utf-8"))
    assert copy["match"]["status"] == "yes"
    assert exp.deps.judge.calls.count("label") == 3 and exp.deps.judge.calls.count("judge") == 3
    prereg = (root / "preregistration.md").read_text(encoding="utf-8")
    assert "SMOKE TEST" in prereg and "5020–5024" in prereg and "standin_02" in prereg


def test_resume_skips_done_variants(hx, tmp_path):
    crash = FakeSim(tmp_path, errors={9: SimWorkerUnavailable("worker died (sleep?)", error="unavailable")})
    exp, _, _ = _exp(hx, tmp_path, sim=crash)
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    with pytest.raises(hx.Stop):
        exp.run(until="sim")
    done_before = [r.out_name for r in crash.requests[:9]]
    again = FakeSim(tmp_path)
    exp2, _, _ = _exp(hx, tmp_path, sim=again)
    exp2.select(ids=None, tag=None, settings=SMOKE)  # a resume: the frozen selection
    exp2.run(until="grid")
    redone = [r.out_name for r in again.requests]
    assert not set(done_before) & set(redone) - {crash.requests[9].out_name}
    assert len(load_grid(tmp_path / "human_exp" / "smoke1" / "grid.json").cells[1].episode_dirs) == 9


def test_config_change_refused(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path)
    exp.select(ids=IDS[:2], tag=None, settings=SMOKE)
    with pytest.raises(hx.Refused, match="steps"):
        exp.select(ids=IDS[:2], tag=None, settings={**SMOKE, "steps": 30000})
    with pytest.raises(hx.Refused, match="ids"):
        exp.select(ids=IDS, tag=None, settings=SMOKE)
    exp.select(ids=None, tag=None, settings=SMOKE)  # resuming with the same settings is fine


def test_nemotron_failure_is_unavailable_and_the_run_finishes(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path, judge=FakeJudge(fail=True))
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    exp.run()
    summary = json.loads((tmp_path / "human_exp" / "smoke1" / "stages" / "nemotron.json").read_text(encoding="utf-8"))
    assert summary["labels"] == {"unavailable": 3} and summary["matches"] == {"unavailable": 3}
    assert (tmp_path / "human_exp" / "smoke1" / "results.json").is_file()


def test_publish_refuses_smoke(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path)
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    exp.run(until="eval")
    with pytest.raises(hx.Refused, match="smoke"):
        exp.results(publish=True)
    assert not (tmp_path / "results" / "results.json").exists()


def test_publish_keeps_a_backup(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path)
    exp.select(ids=None, tag="standin_*", settings={**SMOKE, "smoke": False})
    (tmp_path / "results").mkdir()
    (tmp_path / "results" / "results.json").write_text('{"old": true}', encoding="utf-8")
    exp.run(publish=True)
    assert json.loads((tmp_path / "results" / "results.json").read_text(encoding="utf-8"))["sample"] is False
    assert [json.loads(p.read_text(encoding="utf-8")) for p in (tmp_path / "results").glob("results.json.bak-*")] == [
        {"old": True}]


def test_failed_training_stops(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path, children=FakeChildren(tmp_path, train_status="failed"))
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    with pytest.raises(hx.Stop, match="training failed"):
        exp.run()


def test_raw_arm_verified_drops_failed_physics(hx, tmp_path):
    from fake_sim_worker import verification

    # replay 0 = standin_00's physics check fails; everything after verifies
    sim = FakeSim(tmp_path, results=[verification(False)] + [verification()] * 200)
    exp, _, _ = _exp(hx, tmp_path, sim=sim)
    exp.select(ids=None, tag="standin_*", settings={**SMOKE, "raw_arm": "verified"})
    exp.run(until="grid")
    raw = load_grid(tmp_path / "human_exp" / "smoke1" / "grid.json").cells[0]
    assert [Path(d).parent.name for d in raw.episode_dirs] == ["standin_01_home", "standin_02_home"]


def test_cli_refuses_unknown_demo(hx, tmp_path, capsys):
    _user_store(tmp_path)
    rc = hx.main(["--name", "x", "--ids", "nope", "--data-dir", str(tmp_path), "--no-nemotron", "--smoke"])
    assert rc == 1 and "REFUSED" in capsys.readouterr().out


def _store_with_9f47(root: Path) -> tuple[DemoStore, Demo, dict]:
    """The user's store as the live sink left it: demo.json (commanded targets) + the live episode (achieved)."""
    store = DemoStore(root)
    demo = Demo.model_validate_json((HUMAN_9F47 / "demo.json").read_text(encoding="utf-8"))
    live = {k: np.asarray(v) for k, v in json.loads((HUMAN_9F47 / "live.json").read_text(encoding="utf-8")).items()
            if k != "source"}
    n = len(demo.trajectory.t)
    store.save_demo(demo)
    save_episode(store.episode_dir(demo.id), EpisodeMeta(demo_id=demo.id, robot="franka", task_text="t", fps=50,
                                                         n_steps=n),
                 {"joint_pos": np.zeros((n, 9)), "action": np.zeros((n, 9)), "ee_pos": live["ee_pos"],
                  "ee_quat": live["ee_quat"], "gripper": np.asarray(demo.trajectory.gripper, dtype=np.int8)})
    return store, demo, live


def test_achieved_path_is_what_the_experiment_replays_and_the_users_demo_is_untouched(hx, tmp_path):
    _, demo, live = _store_with_9f47(tmp_path)
    before = _hashes(tmp_path)
    exp, sim, _ = _exp(hx, tmp_path)
    exp.select(ids=[demo.id], tag=None, settings={**SMOKE, "replay_path": "achieved"})
    exp.run(until="sim", sim_until="physics")

    assert _hashes(tmp_path) == before  # the user's demo.json and episode are read, never written
    copy = exp.store.get_demo(demo.id)
    assert np.allclose(copy.trajectory.to_arrays()["ee_pos"], live["ee_pos"])
    assert copy.commanded == demo.trajectory  # the hand targets stay, for diagnostics
    assert np.allclose(sim.requests[0].trajectory.to_arrays()["ee_pos"], live["ee_pos"])  # physics replays it
    root = tmp_path / "human_exp" / "smoke1"
    note = json.loads((root / "store" / "demos" / demo.id / "replay_path.json").read_text(encoding="utf-8"))
    assert note["replay_path"] == "achieved" and "lag" in note["why"] and note["steps_sha256"]
    config = json.loads((root / "config.json").read_text(encoding="utf-8"))
    assert config["replay_path"] == "achieved" and config["steps_sha256"][demo.id] == note["steps_sha256"]
    assert "achieved" in (root / "preregistration.md").read_text(encoding="utf-8")


def test_achieved_path_refuses_a_demo_without_a_live_episode(hx, tmp_path):
    exp, _, _ = _exp(hx, tmp_path)  # stand-ins: no episode
    with pytest.raises(hx.Refused, match="episode"):
        exp.select(ids=IDS[:1], tag=None, settings={**SMOKE, "replay_path": "achieved"})


def test_sim_until_stops_before_multiply_and_a_later_run_carries_on(hx, tmp_path):
    exp, sim, _ = _exp(hx, tmp_path)
    exp.select(ids=None, tag="standin_*", settings=SMOKE)
    exp.run(until="grid", sim_until="align")
    root = tmp_path / "human_exp" / "smoke1"
    names = [r.out_name for r in sim.requests]
    assert sum(n.endswith("_home") for n in names) == 6 and not any("_m3" in n for n in names)
    assert not (root / "stages" / "sim.json").exists() and not (root / "grid.json").exists()
    assert not list((root / "stages").glob("multiply/*.json"))
    exp.run(until="grid")  # the default goes on to multiply and the grid, redoing nothing
    names = [r.out_name for r in sim.requests]
    assert sum(n.endswith("_home") for n in names) == 6 and sum("_m3" in n for n in names) == 6
    assert (root / "grid.json").is_file()


def test_sim_worker_tracks_with_the_frozen_lookahead(hx):
    # The achieved path is where the arm was at the END of each step; commanding pose k at step k reaches it one
    # step late (~0.5 cm at a grasp: live test #10's edge grasps closed on air). lookahead 1 commands k+1.
    cmd = hx.sim_worker_cmd(8770, lookahead=1)
    assert cmd[cmd.index("--lookahead") + 1] == "1" and "--cameras" in cmd and cmd[cmd.index("--port") + 1] == "8770"


def test_replay_lookahead_is_frozen_with_the_replay_path(hx, tmp_path):
    _store_with_9f47(tmp_path)
    exp, _, _ = _exp(hx, tmp_path)
    exp.select(ids=["human_20261019185258_9f47"], tag=None, settings={**SMOKE, "replay_path": "achieved"})
    assert exp.config["replay_lookahead"] == 1  # the achieved path's default
    assert "lookahead 1" in (tmp_path / "human_exp" / "smoke1" / "preregistration.md").read_text(encoding="utf-8")
    with pytest.raises(hx.Refused, match="replay_lookahead"):
        exp.select(ids=["human_20261019185258_9f47"], tag=None,
                   settings={**SMOKE, "replay_path": "achieved", "replay_lookahead": 0})
    exp2, _, _ = _exp(hx, tmp_path / "standins")
    exp2.select(ids=None, tag="standin_*", settings=SMOKE)
    assert exp2.config["replay_lookahead"] == 0  # commanded targets: as before
