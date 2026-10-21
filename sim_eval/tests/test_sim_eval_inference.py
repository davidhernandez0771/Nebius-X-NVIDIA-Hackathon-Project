"""Inference options and checkpoint selection on practice seeds, in the eval driver (eval_cells), run_eval's flags,
the registry and the resumable episode log. All off by default: a pre-registered eval's commands are unchanged.

From the 2026-10-20 research note (docs/superpowers/notes/2026-10-20-research-cube-in-bin.md, Part 3 (c))."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from lerobot_tools.inference import InferenceOptions
from sim_eval.progress import RESUME_KEYS, EpisodeLog
from sim_eval.registry import update_registry
from sim_eval.results import EpisodeResult, aggregate

SCRIPTS = Path(__file__).parents[1] / "scripts"
INFERENCE_PY = Path(__file__).parents[2] / "lerobot_tools" / "inference.py"


def _load_driver():
    import importlib.util

    spec = importlib.util.spec_from_file_location("eval_cells", SCRIPTS / "eval_cells.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _declared_by_run_eval() -> set[str]:
    src = (SCRIPTS / "run_eval.py").read_text("utf-8")
    flags = set(re.findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"', src))
    if "add_inference_args(parser)" in src:
        flags |= set(re.findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"', INFERENCE_PY.read_text("utf-8")))
    return flags


def test_a_default_eval_command_is_unchanged(tmp_path):
    drv = _load_driver()
    kw = dict(python="py", port=8765, n=40, seed0=5020, cell="c", out=tmp_path / "o.json", registry=None)
    assert drv.run_eval_command(**kw) == drv.run_eval_command(**kw, inference=InferenceOptions())
    assert not {"--binarize-gripper", "--n-action-steps", "--temporal-ensemble", "--row-checkpoint",
                "--selection"} & set(drv.run_eval_command(**kw))


def test_inference_flags_reach_run_eval_and_run_eval_declares_them(tmp_path):
    drv = _load_driver()
    cmd = drv.run_eval_command(python="py", port=8765, n=30, seed0=5300, cell="c@040000", out=tmp_path / "o.json",
                               registry=None, inference=InferenceOptions(binarize_gripper=True, n_action_steps=20),
                               row_checkpoint="ck/last", selection=tmp_path / "c.selection.json")
    flags = [a for a in cmd if a.startswith("--")]
    assert set(flags) <= _declared_by_run_eval(), set(flags) - _declared_by_run_eval()
    assert "--binarize-gripper" in cmd and cmd[cmd.index("--n-action-steps") + 1] == "20"
    assert cmd[cmd.index("--row-checkpoint") + 1] == "ck/last"
    assert cmd[cmd.index("--selection") + 1].endswith("c.selection.json")


def test_the_server_command_carries_only_the_server_side_options():
    drv = _load_driver()
    plain = drv.server_command("ck", 8765, InferenceOptions())
    assert plain[-4:] == ["--checkpoint", "ck", "--port", "8765"]
    tuned = drv.server_command("ck", 8765, InferenceOptions(binarize_gripper=True, temporal_ensemble_coeff=0.01))
    assert tuned[-2:] == ["--temporal-ensemble", "0.01"] and "--binarize-gripper" not in tuned


def _row(tmp_path, steps=(10000, 20000, 30000)):
    root = tmp_path / "train" / "cell" / "checkpoints"
    ckpts = [str(root / f"{s:06d}" / "pretrained_model") for s in steps]
    return {"cell": {"name": "cell"}, "checkpoint": ckpts[-1], "checkpoints": ckpts, "dataset": str(tmp_path / "ds")}


def test_selection_candidates_come_from_the_rows_saved_checkpoints(tmp_path):
    drv = _load_driver()
    row = _row(tmp_path)
    got = drv.selection_candidates(row, [20000, 30000])
    assert [s for s, _ in got] == [20000, 30000]
    assert got[0][1].replace("\\", "/").endswith("020000/pretrained_model")
    with pytest.raises(ValueError, match="10000, 20000, 30000"):
        drv.selection_candidates(row, [40000])


def test_the_most_practice_successes_wins_and_a_tie_goes_to_the_later_checkpoint():
    drv = _load_driver()
    assert drv.choose_checkpoint([(40000, 3, 30), (60000, 5, 30), (80000, 5, 30)]) == 80000
    assert drv.choose_checkpoint([(40000, 6, 30), (60000, 5, 30), (80000, 5, 30)]) == 40000
    with pytest.raises(ValueError, match="different n"):
        drv.choose_checkpoint([(40000, 6, 30), (60000, 5, 29)])


def test_practice_seeds_must_not_overlap_the_final_ones():
    drv = _load_driver()
    assert drv.seed_overlap(5300, 30, 5020, 40) is None
    assert "5040" in drv.seed_overlap(5040, 30, 5020, 40)


def test_the_selection_record_names_every_candidate_and_the_rule(tmp_path):
    drv = _load_driver()
    path = drv.write_selection(tmp_path / "c.selection.json", cell="c", practice_seed0=5300, practice_n=30,
                               candidates=[(40000, "a", 3, 30, "pa.json"), (80000, "b", 3, 30, "pb.json")],
                               chosen=80000, inference=InferenceOptions(binarize_gripper=True))
    rec = json.loads(path.read_text(encoding="utf-8"))
    assert rec["chosen"] == {"step": 80000, "checkpoint": "b"}
    assert rec["practice_seeds"] == [5300, 5329] and "tie" in rec["rule"]
    assert [c["successes"] for c in rec["candidates"]] == [3, 3]
    assert rec["inference"]["binarize_gripper"] is True


def _summary():
    return aggregate([EpisodeResult(seed=5020 + i, success=i < 3, reasons=[] if i < 3 else ["not_in_bin"],
                                    ended_by="success" if i < 3 else "time_limit", steps=10, sim_s=0.2, wall_s=1.0)
                      for i in range(10)])


def test_the_registry_records_inference_and_which_checkpoint_was_evaluated(tmp_path):
    reg = tmp_path / "registry.jsonl"
    row = {"cell": {"name": "c"}, "status": "ok", "checkpoint": str(tmp_path / "030000"), "eval_success": None}
    other = {"cell": {"name": "d"}, "status": "ok", "checkpoint": "x", "eval_success": None}
    reg.write_text(json.dumps(row) + "\n" + json.dumps(other) + "\n", encoding="utf-8")
    n = update_registry(reg, "c", _summary(), seed0=5020, checkpoint=str(tmp_path / "030000"),
                        extra={"inference": InferenceOptions().record(), "evaluated_checkpoint": str(tmp_path / "020000"),
                               "selection": "c.selection.json"})
    assert n == 1
    got = json.loads(reg.read_text(encoding="utf-8").splitlines()[0])
    assert got["eval_success"] == 0.3 and got["eval"]["evaluated_checkpoint"].endswith("020000")
    assert got["eval"]["inference"] == {"binarize_gripper": False, "n_action_steps": None, "temporal_ensemble_coeff": None}
    assert json.loads(reg.read_text(encoding="utf-8").splitlines()[1]) == other


def test_a_resume_refuses_a_log_written_with_other_inference_settings(tmp_path):
    assert "inference" in RESUME_KEYS
    path = tmp_path / "e.episodes.jsonl"
    header = {"checkpoint": "ck", "seed0": 5300, "max_seconds": 30.0, "cameras": True, "reset_pose": None,
              "inference": InferenceOptions(binarize_gripper=True).record()}
    EpisodeLog.open(path, header, resume=False)
    with pytest.raises(ValueError, match="inference"):
        EpisodeLog.open(path, {**header, "inference": None}, resume=True)
    EpisodeLog.open(path, header, resume=True)  # the same settings resume


def test_an_old_log_without_inference_resumes_as_a_default_eval(tmp_path):
    path = tmp_path / "old.episodes.jsonl"
    old = {"checkpoint": "ck", "seed0": 5020, "max_seconds": 30.0, "cameras": True, "reset_pose": None}
    path.write_text(json.dumps({"header": old}) + "\n", encoding="utf-8")
    EpisodeLog.open(path, {**old, "inference": None}, resume=True)  # a default eval writes inference None
