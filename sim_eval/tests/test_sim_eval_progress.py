"""Resumable evals: an append-only per-episode log, so a run killed by Windows sleep (T2 lost seeds that way)
resumes at the next seed. Pure, no Isaac."""

from __future__ import annotations

import json

import pytest

from sim_eval.progress import EpisodeLog, remaining
from sim_eval.results import EpisodeResult
from sim_eval.scenes import eval_scenes

HEADER = {"checkpoint": "C:/runs/a/pretrained_model", "seed0": 5000, "max_seconds": 30.0, "cameras": True,
          "reset_pose": [0.0] * 9, "n": 20}


def _ep(seed, ended_by="time_limit"):
    ok = ended_by == "success"
    return EpisodeResult(seed=seed, success=ok, reasons=[] if ok else [ended_by if "error" in ended_by else "not_in_bin"],
                         ended_by=ended_by, steps=10, sim_s=0.2, wall_s=1.0)


def test_a_new_log_starts_empty_and_records_each_episode(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    log, done = EpisodeLog.open(path, HEADER, resume=False)
    assert done == []
    log.append(_ep(5000))
    log.append(_ep(5001, "success"))
    lines = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
    assert lines[0] == {"header": HEADER}
    assert [x["episode"]["seed"] for x in lines[1:]] == [5000, 5001]


def test_an_existing_log_is_not_overwritten_without_resume(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    EpisodeLog.open(path, HEADER, resume=False)
    with pytest.raises(FileExistsError, match="--resume"):
        EpisodeLog.open(path, HEADER, resume=False)


def test_resume_returns_finished_episodes_and_keeps_appending(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    log, _ = EpisodeLog.open(path, HEADER, resume=False)
    for s in (5000, 5001):
        log.append(_ep(s))
    log2, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [e.seed for e in done] == [5000, 5001]
    log2.append(_ep(5002))
    _, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [e.seed for e in done] == [5000, 5001, 5002]


def test_resume_on_a_missing_log_starts_fresh(tmp_path):
    _, done = EpisodeLog.open(tmp_path / "new.jsonl", HEADER, resume=True)
    assert done == []


def test_resume_reruns_infrastructure_failures(tmp_path):
    # sim_error (CUDA died) and policy_error (server down) say nothing about the policy: run those seeds again.
    path = tmp_path / "run.episodes.jsonl"
    log, _ = EpisodeLog.open(path, HEADER, resume=False)
    log.append(_ep(5000))
    log.append(_ep(5001, "sim_error"))
    log.append(_ep(5002, "policy_error"))
    _, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [e.seed for e in done] == [5000]


def test_a_later_record_for_a_seed_wins(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    log, _ = EpisodeLog.open(path, HEADER, resume=False)
    log.append(_ep(5001, "sim_error"))
    log.append(_ep(5000))
    log.append(_ep(5001, "success"))  # the re-run after a resume
    _, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [(e.seed, e.ended_by) for e in done] == [(5000, "time_limit"), (5001, "success")]


def test_a_torn_last_line_is_ignored(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    log, _ = EpisodeLog.open(path, HEADER, resume=False)
    log.append(_ep(5000))
    with path.open("a", encoding="utf-8") as f:
        f.write('{"episode": {"seed": 50')  # the process died mid-write
    _, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [e.seed for e in done] == [5000]


def test_resume_refuses_a_different_run(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    EpisodeLog.open(path, HEADER, resume=False)
    with pytest.raises(ValueError, match="checkpoint"):
        EpisodeLog.open(path, {**HEADER, "checkpoint": "C:/runs/b"}, resume=True)
    with pytest.raises(ValueError, match="reset_pose"):
        EpisodeLog.open(path, {**HEADER, "reset_pose": None}, resume=True)
    # a larger n is fine: scenes are prefix-stable, so --n 50 extends an --n 20 run
    EpisodeLog.open(path, {**HEADER, "n": 50}, resume=True)


def test_remaining_skips_finished_seeds_in_order():
    scenes = eval_scenes(5)
    rest = remaining(scenes, [_ep(5001), _ep(5003)])
    assert [s.seed for s in rest] == [5000, 5002, 5004]
    assert remaining(scenes, []) == scenes


def test_remaining_refuses_episodes_from_outside_the_scene_range():
    with pytest.raises(ValueError, match="5007"):
        remaining(eval_scenes(5), [_ep(5007)])


def test_a_torn_line_does_not_break_a_second_resume(tmp_path):
    path = tmp_path / "run.episodes.jsonl"
    log, _ = EpisodeLog.open(path, HEADER, resume=False)
    log.append(_ep(5000))
    with path.open("a", encoding="utf-8") as f:
        f.write('{"episode": {"seed": 50')
    log, _ = EpisodeLog.open(path, HEADER, resume=True)
    log.append(_ep(5001))
    _, done = EpisodeLog.open(path, HEADER, resume=True)
    assert [e.seed for e in done] == [5000, 5001]
