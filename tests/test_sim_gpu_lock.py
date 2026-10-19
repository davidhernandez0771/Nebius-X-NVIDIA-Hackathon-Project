"""sim_worker.gpu_lock: the cross-terminal GPU lock file (C:\\dev\\gpu.lock). Pure: liveness and sleep are injected."""
from __future__ import annotations

from datetime import datetime

import pytest

from sim_worker.gpu_lock import GpuLock, LockInfo, format_lock, parse_lock, pid_alive

WHEN = datetime(2026, 10, 18, 21, 5, 0)


def _lock(path, task="human-exp:sim", alive=lambda pid: False, sleeps=None, pid=4242, **kw):
    sleeps = [] if sleeps is None else sleeps
    return GpuLock(path, task, pid=pid, alive=alive, sleep=sleeps.append, now=lambda: WHEN, log=lambda m: None, **kw)


def test_format_and_parse_round_trip():
    text = format_lock("T4", 4242, "human-exp:train", WHEN)
    assert text == "T4 4242 human-exp:train 2026-10-18T21:05:00\n"
    assert parse_lock(text) == LockInfo(owner="T4", pid=4242, task="human-exp:train", when="2026-10-18T21:05:00")


@pytest.mark.parametrize("text", ["", "garbage", "T3 notapid task t", "T3"])
def test_parse_garbage_is_none(text):
    assert parse_lock(text) is None


def test_lock_written_and_removed(tmp_path):
    path = tmp_path / "gpu.lock"
    with _lock(path):
        assert path.read_text(encoding="utf-8") == "T4 4242 human-exp:sim 2026-10-18T21:05:00\n"
    assert not path.exists()


def test_lock_released_on_error(tmp_path):
    path = tmp_path / "gpu.lock"
    with pytest.raises(RuntimeError):
        with _lock(path):
            raise RuntimeError("training crashed")
    assert not path.exists()


def test_lock_waits_on_live_foreign_pid_every_5_min(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("T3 777 eval 2026-10-18T20:00:00\n", encoding="utf-8")
    checks = iter([True, True, False])  # alive, alive, then gone
    sleeps = []
    with _lock(path, alive=lambda pid: pid == 777 and next(checks), sleeps=sleeps):
        assert parse_lock(path.read_text(encoding="utf-8")).owner == "T4"
    assert sleeps == [300, 300]
    assert not path.exists()


def test_lock_takes_over_dead_or_garbage(tmp_path):
    path = tmp_path / "gpu.lock"
    for stale in ("T2 999 render 2026-10-18T10:00:00\n", "half-written"):
        path.write_text(stale, encoding="utf-8")
        sleeps = []
        with _lock(path, sleeps=sleeps):
            assert parse_lock(path.read_text(encoding="utf-8")).pid == 4242
        assert sleeps == []


def test_lock_not_deleted_if_someone_else_rewrote_it(tmp_path):
    path = tmp_path / "gpu.lock"
    with _lock(path):
        path.write_text("T3 777 eval 2026-10-18T22:00:00\n", encoding="utf-8")
    assert path.read_text(encoding="utf-8").startswith("T3 777")


def test_lock_own_pid_counts_as_ours(tmp_path):
    """A lock left by this very process (re-entry after a crash in the same run) is not waited on."""
    path = tmp_path / "gpu.lock"
    path.write_text("T4 4242 older 2026-10-18T20:00:00\n", encoding="utf-8")
    sleeps = []
    with _lock(path, alive=lambda pid: True, sleeps=sleeps):
        pass
    assert sleeps == []


def test_lock_gives_up_after_max_wait(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("T3 777 eval 2026-10-18T20:00:00\n", encoding="utf-8")
    with pytest.raises(TimeoutError):
        with _lock(path, alive=lambda pid: True, max_wait_s=600):
            pass
    assert path.read_text(encoding="utf-8").startswith("T3 777")


def test_pid_alive_for_this_process_and_not_for_a_dead_one():
    import os

    assert pid_alive(os.getpid())
    assert not pid_alive(0x7FFFFFF0)
